const fs = require('fs');
const path = require('path');
const resolve = require('resolve');
const loadJsonFile = require('load-json-file');
const writeJsonFile = require('write-json-file');
const { webpackPath } = require('../const.js');
const { compareVersion } = require('../util/util.js');
const { debugInfo, debugError } = require('../util/debug.js')

async function getPackageJson(base) {
  try {
    const file = path.resolve(base, 'package.json');
    return await loadJsonFile(file);
  } catch (err) {
    debugError('package.json', err.message);
  }
}

/**
 *
 * @param base
 * @param json
 * @return {{}|null}
 */
function getAliasByJsonAlias(base, json) {
  debugInfo("alias", "根据webpack配置文件处理alias");
  if (!json)
    return null;
  const res = {};
  for (const key in json) {
    const value = json[key];
    if (value.indexOf(base) !== -1) {
      const src = json[key].replace(base, '');
      res[key] = `path.resolve(__dirname, '.${src}')`;
    } else {
      res[key] = `'${value}'`;
    }
  }
  debugInfo("alias", "处理alias完成");
  return res;
}

/**
 * mock http-proxy-middleware来获取项目中配置的代理
 * @param base
 * @return {Promise<{}|boolean>}
 */
async function getProxyByMock(base) {
  debugInfo('proxy', '开始处理');
  const setupProxyPath = path.join(base, '/src/setupProxy.js');
  if (!fs.existsSync(setupProxyPath)) {
    debugInfo('proxy', '无src/setupProxy.js配置文件，处理结束.');
    return false;
  }
  const middleJson = path.join(base, 'node_modules/http-proxy-middleware/package.json');
  if (!fs.existsSync(middleJson)) {
    debugInfo('proxy', '无http-proxy-middleware模块文件，处理结束.');
    return false;
  }
  try {
    const json = await loadJsonFile(middleJson);
    const middlePath = path.join(base + '/node_modules/http-proxy-middleware/', json.main);
    const res = {};
    function mockCreateProxyMiddleware(context, options) {
      res[context] = options
    }
    if (compareVersion(json.version, '1.0.0')) {
      debugInfo('proxy', `http-proxy-middleware版本大于1，开始mock`);
      const hpm = require(middlePath);
      hpm.createProxyMiddleware = mockCreateProxyMiddleware;
      const setup = require(setupProxyPath);
      setup({ use: () => {}});
      delete require.cache[middlePath]
      debugInfo('proxy', `处理完成，共处理${Object.keys(res).length}个代理.`);
      return res;
    } else {
      debugInfo('proxy', `http-proxy-middleware版本小于1，开始mock`);
      const hpm = mockCreateProxyMiddleware;
      require.cache[middlePath] = {
        exports: hpm
      };
      const setup = require(setupProxyPath);
      setup({ use: () => {}});
      delete require.cache[middlePath]
      debugInfo('proxy', `处理完成，共处理${Object.keys(res).length}个代理.`);
      return res;
    }
  } catch (err) {
    debugError('proxy', err.message);
  }
}

/**
 * 根据tsconfig.json或者jsconfig.json来获取alias
 * @param base
 * @param hasTsConfig
 * @return {Promise<{}|null>}
 */
async function getAliasConfByConfig(base, hasTsConfig) {
  debugInfo('alias', `根据config.json获取别名`);
  const file = path.join(base, hasTsConfig ? '/tsconfig.json' : '/jsconfig.json');
  let json;
  if (hasTsConfig) {
    const ts = require(resolve.sync('typescript', {
      basedir: path.join(base, '/node_modules'),
    }));
    json = ts.readConfigFile(file, ts.sys.readFile).config;
  } else {
    json = require(file);
  }
  if (json && json.compilerOptions && json.compilerOptions.baseUrl) {
    debugInfo('alias', `项目的baseUrl为:${json.compilerOptions.baseUrl}`);
    const alias = {}
    const src = json.compilerOptions.baseUrl;
    const files = fs.readdirSync(path.join(base, '/' + src));
    files.forEach(function(item, index) {
      let stat = fs.statSync(path.join(base, '/' + src + '/' + item));
      if (stat.isDirectory() === true) {
        alias[item] = `path.resolve(__dirname, '${src}/${item}')`;
      }
    })
    return alias;
  }
  debugInfo('alias', `别名获取完成`);
  return null;
}

/**
 * 判断是否存在tsconfig.json或者jsconfig.json
 * @param base
 * @return {{hasTsConfig: boolean, hasJsConfig: boolean}}
 */
function checkoutTJSConfig(base) {
  debugInfo('[ts/js]json', `config.json文件判断`);
  const hasTsConfig = fs.existsSync(path.join(base, '/tsconfig.json'));
  const hasJsConfig = fs.existsSync(path.join(base, '/jsconfig.json'));
  return {
    hasTsConfig, hasJsConfig
  };
}

/**
 * 获取绝对地址
 * @param base
 * @param config
 * @return {string|boolean}
 */
function getConfigPath(base, config) {
  const result = path.resolve(base, config);
  if (result && fs.existsSync(result)) {
    return result;
  } else {
    return false;
  }
}

/**
 * 获取react项目的webpack.config.js的json数据
 * @param base 根目录
 * @param isReactAppRewired 是否是customer-cra创建的项目
 * @param hasEject 是否进行了eject
 * @return {*}
 */
function getWebpackConfigJson(base, isReactAppRewired, hasEject, configFile = '') {
  debugInfo('webpack', '开始处理webpack配置文件');
  if (isReactAppRewired) {
    configFile = webpackPath.rar;
  } else if (hasEject) {
    configFile = webpackPath.craWithEject;
  } else {
    configFile = webpackPath.craNoEject;
  }
  debugInfo('webpack', `webpack配置文件为:${configFile}`);
  // 获取webpack的配置文件地址
  const configPath = getConfigPath(base, configFile);
  // 设置环境变量
  process.env.NODE_ENV = 'development';

  // 获取webpack配置的alias；
  if (!configPath) {
    throw new Error("为获取到配置文件，请用参数输入 --config");
  }

  let configJson;
  if (isReactAppRewired) {
    debugInfo('webpack', `webpack配置文件解析中`);
    const overrideConfig = require(configPath);
    const webpackConfig = require(getConfigPath(base, webpackPath.craNoEject))
    configJson = overrideConfig(webpackConfig('development'), 'development');
  } else {
    debugInfo('webpack', `webpack配置文件解析中`);
    const webpackConfig = require(configPath);
    if (typeof webpackConfig === "function") {
      configJson = webpackConfig('development');
    } else {
      configJson = webpackConfig;
    }
  }
  debugInfo('webpack', `webpack配置文件解析完成`);
  return configJson;
}

async function writePackageJson(base, json) {
  const file = path.resolve(base, 'package.json');
  await writeJsonFile(file, json);
}

function getVueWebpackConfigJson(base, config) {
  let configJson;
  const wpConfig = getConfigPath(base, config || webpackPath.vueWebpack);
  const webpackConfig = require(wpConfig);
  if (typeof webpackConfig === "function") {
    configJson = webpackConfig('development');
  } else {
    configJson = webpackConfig;
  }
  return configJson
}

function getVueConfigJson(base) {
  let configJson;
  const wpConfig = getConfigPath(base, webpackPath.vue);
  const webpackConfig = require(wpConfig);
  if (typeof webpackConfig === "function") {
    configJson = webpackConfig('development');
  } else {
    configJson = webpackConfig;
  }
  return configJson
}



/**
 *
 * @param base
 * @param entry
 * @return {(string|undefined)[]}
 */
function getEntries(base, entries) {
  debugInfo('entry', `根据webpack的配置获取入口`);
  const cwd = process.cwd();
  let res = [];
  if (Array.isArray(entries) || typeof entries === 'object') {
    for (const key in entries) {
      const entry = entries[key];
      if (Array.isArray(entry)) {
        for (const val of entry) {
          if (val.indexOf('node_modules') === -1) {
            res.push(val.replace(cwd, ''));
          }
        }
      } else {
        if (entry.indexOf('node_modules') === -1) {
          res.push(entry.replace(cwd, ''));
        }
      }
    }
  } else if (typeof entries === 'string') {
    res.push(entries.replace(cwd, ''));
  }

  debugInfo('entry', `入口获取完成，入口为: ${res}`);
  return res;
}

module.exports = {
  getPackageJson,
  getAliasByJsonAlias,
  getProxyByMock,
  getAliasConfByConfig,
  checkoutTJSConfig,
  getConfigPath,
  getWebpackConfigJson,
  writePackageJson,
  getVueWebpackConfigJson,
  getVueConfigJson,
  getEntries,
}
