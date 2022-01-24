import { readFileSync } from 'fs'
import { compile, Options, Data } from 'ejs'
import { LoaderContext } from 'webpack'

import type { AdditionalData, SourceMap } from './types'
type EjsLoaderContext = LoaderContext<Options & { data?: Data | string }>

const requireFunction = (requestPath: string) => {
  if (requestPath.endsWith('.json')) {
    return JSON.parse(readFileSync(requestPath, 'utf-8'))
  } else {
    return require(requestPath)
  }
}

const resolveRequirePaths = async (context: EjsLoaderContext, content: string) => {
  const requirePattern = /<%[_\W]?.*(require\(.*\)).*[_\W]?%>/g
  let resultContent = content

  let matches = requirePattern.exec(content)

  while (matches) {
    const matchFilename = matches[1].match(/(['"`])[^'"`]*\1/)
    const requestSource = matchFilename !== null ? matchFilename[0].replace(/['"`]/g, '') : null

    if (requestSource !== null) {
      const result = await context.getResolve()(context.context, requestSource)
      resultContent = resultContent.replace(matches[1], `require('${result}')`)
    }

    matches = requirePattern.exec(content)
  }

  return resultContent
}

// Since Node.js had marked the querystring as legacy API in version 14.x, and recommended using URLSearchParams,
// we should migrate from "querystring" to "URLSearchParams" if we want to get URL query string here.
// check this: https://www.linkedin.com/pulse/how-migrate-from-querystring-urlsearchparams-nodejs-vladim%C3%ADr-gorej?trk=articles_directory
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const obj2URLQueryString = (config?: { [prop: string]: any }) => {
  if (!config) return ''
  const optionArr: string[][] = []
  Object.keys(config).forEach((key) => {
    const optionItem = [key, JSON.stringify(config[key])]
    optionArr.push(optionItem)
  })
  return new URLSearchParams(optionArr).toString()
}

export type htmlWebpackPluginTemplateCustomizerConfig = {
  htmlLoaderOption?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any
  }
  templateEjsLoaderOption?: Options & { data?: Data | string }
  templatePath?: string
}

export function htmlWebpackPluginTemplateCustomizer(config: htmlWebpackPluginTemplateCustomizerConfig) {
  const htmlLoader = `${require.resolve('html-loader')}` // get html-loader entry path
  const templateEjsLoader = `${require.resolve('template-ejs-loader')}` // get template-ejs-loader entry path

  let htmlLoaderOption = `${obj2URLQueryString(config.htmlLoaderOption)}` // get html-loader option
  let templateEjsLoaderOption = `${obj2URLQueryString(config.templateEjsLoaderOption)}` // get template-ejs-loader option
  // Check if option string is empty; (And if it's not, prepend a questionmark '?');
  // This usage is about webpack loader inline, you can check the spec here : https://webpack.js.org/concepts/loaders/#inline
  if (htmlLoaderOption) {
    htmlLoaderOption = `?${htmlLoaderOption}`
  }
  if (templateEjsLoaderOption) {
    templateEjsLoaderOption = `?${templateEjsLoaderOption}`
  }
  // combile loaders/loader options/templatePath then generate customized template name
  return `!${htmlLoader}${htmlLoaderOption}!${templateEjsLoader}${templateEjsLoaderOption}!${config.templatePath}`
}

export default async function ejsLoader(
  this: EjsLoaderContext,
  content: string,
  sourceMap: string | SourceMap,
  additionalData: AdditionalData
) {
  const callback = this.async()

  const loaderOptions = this.getOptions()
  if (loaderOptions.data !== undefined && typeof loaderOptions.data === 'string') {
    Object.assign(loaderOptions, { data: JSON.parse(loaderOptions.data) })
  }

  const originalIncluder = loaderOptions.includer??null;
  const customizeIncluder = (originalPath:string, parsedPath:string)=>{
    this.addDependency(parsedPath);
    if(originalIncluder!==null){
      return originalIncluder(originalPath, parsedPath);
    }
    else{
      return {
        filename:parsedPath,
      };
    }
  }

  loaderOptions.includer = customizeIncluder;

  const ejsOptions = Object.assign(
    {
      filename: this.resourcePath,
    },
    loaderOptions
  )

  if (Object.keys(loaderOptions.data ?? {}).includes('require')) {
    callback(Error('Do not set "require" in the loader options'))
  }

  const currentHtmlWebpackPlugin = this._compiler?.options.plugins.filter(
    (plugin) =>
      typeof plugin === 'object' &&
      plugin.options &&
      plugin.options.template &&
      plugin.options.template === this.resource
  )[0]
  const templateParameters = {}
  if (
    typeof currentHtmlWebpackPlugin === 'object' &&
    typeof currentHtmlWebpackPlugin.options.templateParameters !== 'function'
  ) {
    Object.assign(templateParameters, {
      htmlWebpackPlugin: {
        options: currentHtmlWebpackPlugin.options.templateParameters,
      },
    })
  }

  const parameter = Object.assign(
    {
      require: (source: string) => requireFunction(source),
    },
    loaderOptions.data,
    templateParameters
  )

  try {
    const resolveContent = await resolveRequirePaths(this, content)
    const template = await compile(resolveContent, ejsOptions)(parameter)


    callback(null, template, sourceMap, additionalData)
  } catch (error) {
    callback(error as Error)
  }
}

export type { SourceMap, AdditionalData }
