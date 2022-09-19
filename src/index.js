console.clear()

import './polyfill.js'
import { FEM_ENDPOINT, FEM_API_ENDPOINT, FEM_CAPTIONS_ENDPOINT, CAPTION_EXT, PLAYLIST_EXT, QUALITY_FORMAT, FEM_COURSE_REG, SUPPORTED_FORMATS } from './constants.js'
import { sleep, isPathExists, ensureDir, get, safeJoin } from './util/common.js'
import M3u8 from './util/m3u8.js'
import ffmpeg from './util/ffmpeg.js'
import puppeteer from 'puppeteer'
import fs from 'node:fs/promises'
import prompts from 'prompts'
import ora from 'ora'
import colors from 'kleur'
import os from 'node:os'

const exitOnCancel = (state) => {
    if (state.aborted) process.nextTick(() => process.exit(0))
}

const {
    COURSE_SLUG,
    QUALITY,
    DOWNLOAD_DIR,
    EXTENSION,
    INCLUDE_CAPTION,
    COOKIES
} = await prompts([{
    type: 'text',
    name: 'COURSE_SLUG',
    message: 'The url of the course you want to download',
    initial: 'https://frontendmasters.com/courses/...',
    validate: v => !v.endsWith('...') && FEM_COURSE_REG.test(v),
    format: v => v.match(FEM_COURSE_REG)[2],
    onState: exitOnCancel
}, {
    type: 'password',
    name: 'COOKIES',
    message: 'Paste the value of "wordpress_logged_in_xxx" cookie (visit: frontendmasters.com)',
    format: value => ({
        name: 'wordpress_logged_in_323a64690667409e18476e5932ed231e',
        value,
        domain: '.frontendmasters.com',
        httpOnly: true
    }),
    onState: exitOnCancel
}, {
    type: 'select',
    name: 'QUALITY',
    message: 'Which stream quality do you prefer?',
    choices: [2160, 1440, 1080, 720, 360].map((value) => ({ title: value + 'p', value })),
    format: v => QUALITY_FORMAT[v],
    onState: exitOnCancel
}, {
    type: 'select',
    message: 'Which video format you prefer?',
    name: 'EXTENSION',
    initial: 0,
    choices: SUPPORTED_FORMATS.map((value) => ({ title: value, value })),
    onState: exitOnCancel
}, {
    type: 'confirm',
    initial: true,
    name: 'INCLUDE_CAPTION',
    message: 'Insert caption/subtitle to the episodes?',
    onState: exitOnCancel
}, {
    type: 'text',
    message: 'Download directory path',
    name: 'DOWNLOAD_DIR',
    initial: safeJoin(os.homedir(), 'Downloads'),
    validate: v => isPathExists(v),
    onState: exitOnCancel
}])

console.clear()

const
    spinner = ora('Launching chromium engine...').start(),
    browser = await puppeteer.launch({
        headless: true,
        args: ['--fast-start', '--disable-extensions', '--no-sandbox']
    }),
    page = await browser.newPage()

spinner.text = `Going to "${colors.underline().italic(FEM_ENDPOINT)}"`

await page.setCookie(COOKIES)
await page.goto(FEM_ENDPOINT + '/manifest.json')

spinner.text = 'Fetching course payload'

const course = await page.fetch(`${FEM_API_ENDPOINT}/kabuki/courses/${COURSE_SLUG}`, 'json')

if (course.code === 404) {
    spinner.fail(`Couldn't find this course "${COURSE_SLUG}"`)
    process.exit()
}

for (const data of Object.values(course.lessonData)) course.lessonElements[course.lessonElements.findIndex(x => x === data.index)] = {
    title: data.title,
    slug: data.slug,
    url: `${data.sourceBase}/source?f=${PLAYLIST_EXT}`,
    index: data.index
}

const [lessons, totalEpisodes] = course.lessonElements.reduce((acc, cur) => {
    if (typeof cur === 'string') (acc[0][cur] = [], acc[2] = cur)
    else (acc[0][acc[2]].push(cur), acc[1]++)
    return acc
}, [{}, 0, ''])


let i = 1, x = totalEpisodes

const coursePath = safeJoin(DOWNLOAD_DIR, course.title)

for (const [lesson, episodes] of Object.entries(lessons)) {
    const
        lessonName = `${i++}. ${lesson}`,
        lessonPath = safeJoin(coursePath, lessonName),
        lessonTempDir = safeJoin(lessonPath, '.tmp')

    await ensureDir(lessonPath)

    for (const episode of episodes) {
        const
            fileName = `${episode.index + 1}. ${episode.title}.${EXTENSION}`,
            tempDir = safeJoin(lessonTempDir, QUALITY, episode.title),
            decryptionKeyPath = safeJoin(tempDir, 'key.bin'),
            captionPath = safeJoin(tempDir, `caption.${CAPTION_EXT}`),
            playlistPath = safeJoin(tempDir, `playlist.${PLAYLIST_EXT}`),
            filePath = safeJoin(tempDir, fileName),
            finalFilePath = safeJoin(lessonPath, fileName)

        spinner.text = `Downloading ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Chunks: N/A | Remaining: ${x--}/${totalEpisodes}`

        if (await isPathExists(finalFilePath)) {
            await sleep(100)
            continue
        }

        await ensureDir(tempDir)

        const
            { url: m3u8Url } = await page.fetch(episode.url, 'json'),
            m3u8 = new M3u8(await page.fetch([...m3u8Url.split('/').slice(0, -1), `${QUALITY}.${PLAYLIST_EXT}`].join('/'))),
            key = await get(m3u8.decryptionKey),
            captions = INCLUDE_CAPTION ? await get(`${FEM_CAPTIONS_ENDPOINT}/assets/courses/${course.datePublished}-${course.slug}/${episode.index}-${episode.slug}.${CAPTION_EXT}`) : null

        m3u8.setDecryptionKey('key.bin')

        await Promise.all([
            fs.writeFile(decryptionKeyPath, key),
            fs.writeFile(playlistPath, m3u8.toString()),
            captions ? fs.writeFile(captionPath, captions) : Promise.resolve(),
        ])

        for (let j = 0; j < m3u8.totalChunks; j++) {
            const
                chunkName = `${QUALITY}_${(j + 1).toString().padStart(5, '0')}.ts`,
                chunkPath = safeJoin(tempDir, chunkName),
                chunkUrl = [...m3u8Url.split('/').slice(0, -1), chunkName].join('/')

            if (await isPathExists(chunkPath)) {
                continue
            }

            const chunk = await page.fetch(chunkUrl, 'binary')

            await fs.writeFile(chunkPath, chunk)

            spinner.text = `Downloading ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Chunks: ${j + 1}/${m3u8.totalChunks} | Remaining: ${x + 1}/${totalEpisodes}`
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
    }

    await fs.rm(lessonTempDir, { force: true, recursive: true })
}

spinner.text = 'Closing chromium engine... we almost done.'

await browser.close()

spinner.succeed('Finished')
