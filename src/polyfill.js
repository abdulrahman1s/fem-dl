import { Page } from 'puppeteer/lib/esm/puppeteer/common/Page.js'

Page.prototype.fetch = async function (url, type = 'text') {
    let code

    if (type === 'text' || type === 'json') code = `fetch("${url}", { credentials: "include" }).then(r => r.${type}())`
    // https://github.com/puppeteer/puppeteer/issues/3722
    else if (type === 'binary') code = `fetch("${url}", { credentials: "include" }).then(r => new Promise(async resolve => {
        const reader = new FileReader();
        reader.readAsBinaryString(await r.blob());
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject('Error occurred while reading binary string');
   }))`
    else throw new Error('Unknown type: ' + type)

    const result = await this.evaluate(code)

    return type === 'binary' ? Buffer.from(result, 'binary') : result
}