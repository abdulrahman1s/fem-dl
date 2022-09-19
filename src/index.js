console.clear()

import { FEM_API_ENDPOINT, FEM_CAPTIONS_ENDPOINT, CAPTION_EXT, PLAYLIST_EXT, QUALITY_FORMAT } from './constants.js'
import { ffmpeg, sleep, isPathExists, ensureDir, get, M3u8 } from './util'
import { join } from 'node:path'
import puppeteer from 'puppeteer'
import fs from 'node:fs/promises'
import prompts from 'prompts'
import ora from 'ora'
import colors from 'kleur'
import cookies from '../cookies.json'

const {
    URL,
    QUALITY,
    DOWNLOAD_DIR,
    EXTENSION,
    INCLUDE_CAPTION
} = await prompts([{
    type: 'text',
    name: 'URL',
    message: 'The url of the course you want to download (any lesson/section link)',
    validate: v => v.startsWith('https://')
}, {
    type: 'select',
    name: 'QUALITY',
    message: 'Which stream quality do you prefer? ',
    choices: [
        { title: '2160p', value: 2160 },
        { title: '1440p', value: 1440 },
        { title: '1080p', value: 1080 },
        { title: '720p', value: 720 },
        { title: '360p', value: 360 }
    ],
    format: v => QUALITY_FORMAT[v]
}, {
    type: 'select',
    message: 'Which video format you prefer?',
    name: 'EXTENSION',
    initial: 0,
    choices: [{
        title: 'mp4',
        value: 'mp4'
    }, {
        title: 'mkv',
        value: 'mkv'
    }]
}, {
    type: 'confirm',
    initial: true,
    name: 'INCLUDE_CAPTION',
    message: 'Insert caption/subtitle to the episodes?'
}, {
    type: 'text',
    message: 'Download directory path',
    name: 'DOWNLOAD_DIR',
    initial: process.cwd(),
    validate: v => isPathExists(v)
}])

console.clear()

const spinner = ora().start('Launching chrome engine...')
const browser = await puppeteer.launch({
    headless: true,
    args: ["--fast-start", "--disable-extensions", "--no-sandbox"],
})

const page = await browser.newPage()

await page.setCookie(...cookies)

spinner.text = `Going to "${colors.underline().italic(URL)}"`

await page.goto(URL)

async function domFetch(url, type = 'text') {
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

    const result = await page.evaluate(code)

    return type === 'binary' ? Buffer.from(result, 'binary') : result
}


spinner.text = 'Waiting for course payload'

const response = await page.waitForResponse(res => {
    if (spinner.text.endsWith('...')) spinner.text = spinner.text.slice(0, -3)
    spinner.text += '.'
    return res.request().method() === 'GET' && res.url().startsWith(`${FEM_API_ENDPOINT}/kabuki/courses/`)
})

const course = await response.json()
const lessons = course.lessonElements
let totalEpisodes = lessons.reduce((acc, cur) => typeof cur === 'number' ? acc += 1 : acc, 0)

for (const data of Object.values(course.lessonData)) lessons[lessons.findIndex(x => x === data.index)] = {
    title: data.title,
    slug: data.slug,
    url: `${data.sourceBase}/source?f=${PLAYLIST_EXT}`,
    index: data.index
}

let j = 0;


for (let i = 0; i < lessons.length; i++) {
    const episode = lessons[i]

    if (typeof episode === 'string') {
        j = i
        await ensureDir(join(course.title, lessons[j]))
        continue
    }

    // \ / : * ? " < > | are not allowed in windows file name
    const safePath = title => title.replace(/[\\/:*?"<>|]/g, '')

    const
        lessonName = lessons[j],
        safeLessonName = safePath(lessonName),
        safeCourseTitle = safePath(course.title),
        safeEpisodeTitle = safePath(episode.title),
        fileName = `${episode.index + 1}. ${safeEpisodeTitle}.${EXTENSION}`,
        path = join(DOWNLOAD_DIR, safeCourseTitle, safeLessonName),
        tempDir = join(path, '.tmp', safeEpisodeTitle),
        filePath = join(tempDir, fileName),
        decryptionKeyPath = join(tempDir, 'key.bin'),
        captionPath = join(tempDir, `caption.${CAPTION_EXT}`),
        playlistPath = join(tempDir, `playlist.${PLAYLIST_EXT}`),
        finalFilePath = join(path, fileName)


    spinner.text = `Downloading ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Chunks: N/A | Remaining: ${--totalEpisodes}`

    if (await isPathExists(finalFilePath)) {
        await sleep(100)
        continue
    }

    await ensureDir(tempDir)

    const
        { url: m3u8Url } = await domFetch(episode.url, 'json'),
        m3u8 = new M3u8(await domFetch([...m3u8Url.split('/').slice(0, -1), `${QUALITY}.${PLAYLIST_EXT}`].join('/'), 'text')),
        key = await get(m3u8.decryptionKey),
        captions = INCLUDE_CAPTION ? await get(`${FEM_CAPTIONS_ENDPOINT}/assets/courses/${course.datePublished}-${course.slug}/${episode.index}-${episode.slug}.${CAPTION_EXT}`) : null

    m3u8
        .setDecryptionKey('key.bin')

    await Promise.all([
        fs.writeFile(decryptionKeyPath, key),
        fs.writeFile(playlistPath, m3u8.toString()),
        captions ? fs.writeFile(captionPath, captions) : Promise.resolve(),
    ])

    for (let x = 0; x < m3u8.totalChunks; x++) {
        const
            chunkName = `${QUALITY}_${(x + 1).toString().padStart(5, '0')}.ts`,
            chunkPath = join(tempDir, chunkName),
            chunkUrl = [...m3u8Url.split('/').slice(0, -1), chunkName].join('/')

        if (await isPathExists(chunkPath)) {
            continue
        }

        const chunk = await domFetch(chunkUrl, 'binary')
        await fs.writeFile(chunkPath, chunk)
        spinner.text = `Downloading ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Chunks: ${x+1}/${m3u8.totalChunks} | Remaining: ${totalEpisodes}`
    }

    // Merge chunks into one file.
    await ffmpeg(
        '-y',
        '-allowed_extensions', 'ALL',
        '-i', playlistPath,
        '-map', '0',
        '-c',
        'copy', INCLUDE_CAPTION ? filePath : finalFilePath
    )

    // Insert subtitles
    if (INCLUDE_CAPTION) {
        if (EXTENSION === 'mkv') {
            await ffmpeg(
                '-y',
                '-i', filePath,
                '-i', captionPath,
                '-map', '0',
                '-map', '1',
                '-c',
                'copy',
                finalFilePath
            )
        } else {
            await ffmpeg(
                '-y',
                '-i', filePath,
                '-i', captionPath,
                '-c',
                'copy',
                '-c:s', 'mov_text',
                '-metadata:s:s:0', 'language=eng',
                finalFilePath
            )
        }
    }

    await fs.rm(tempDir, { force: true, recursive: true })
}

spinner.text = 'Closing chrome engine... we almost done.'

await browser.close()

spinner.succeed('Finished')
