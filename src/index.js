#!/usr/bin/env node

import { FEM_ENDPOINT, FEM_API_ENDPOINT, FEM_CAPTIONS_ENDPOINT, CAPTION_EXT, PLAYLIST_EXT, QUALITY_FORMAT, FEM_COURSE_REG, SUPPORTED_FORMATS } from './constants.js'
import { sleep, isPathExists, ensureDir, extendedFetch, safeJoin, formatBytes } from './util/common.js'
import ffmpeg from './util/ffmpeg.js'
import fs from 'node:fs/promises'
import prompts from 'prompts'
import ora from 'ora'
import colors from 'kleur'
import os from 'node:os'
import https, { Agent } from 'node:https'
import extendFetchCookie from 'fetch-cookie'
import { FfmpegProgress } from '@dropb/ffmpeg-progress'

console.clear()

https.globalAgent = new Agent({ keepAlive: true })

const env = process.env
const exitOnCancel = (state) => {
    if (state.aborted) process.nextTick(() => process.exit(0))
}

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36'

const {
    COURSE_SLUG,
    PREFERRED_QUALITY,
    DOWNLOAD_DIR,
    EXTENSION,
    INCLUDE_CAPTION,
    TOKEN
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
    name: 'TOKEN',
    message: 'Paste the value of "wordpress_logged_in_xxx" cookie (visit: frontendmasters.com)',
    format: v => decodeURIComponent(v) === v ? encodeURIComponent(v) : v,
    onState: exitOnCancel
}, {
    type: 'select',
    name: 'PREFERRED_QUALITY',
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

const headers = {
    'User-Agent': USER_AGENT,
    'Origin': 'https://frontendmasters.com',
    'Referer': 'https://frontendmasters.com/'
}

const cookies = new extendFetchCookie.toughCookie.CookieJar()

cookies.setCookieSync(`wordpress_logged_in_323a64690667409e18476e5932ed231e=${TOKEN}; Path=/; Domain=frontendmasters.com; HttpOnly; Secure`, FEM_ENDPOINT)

const fetch = extendedFetch({
    headers,
    retries: 5,
    retryDelay: 1000
}, cookies)

const spinner = ora(`Searching for ${COURSE_SLUG}...`).start()
const course = await fetch.json(`${FEM_API_ENDPOINT}/kabuki/courses/${COURSE_SLUG}`)

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


let i = 1, x = totalEpisodes, QUALITY = PREFERRED_QUALITY

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
            captionPath = safeJoin(tempDir, `caption.${CAPTION_EXT}`),
            filePath = safeJoin(tempDir, fileName),
            finalFilePath = safeJoin(lessonPath, fileName)

        spinner.text = `Downloading [0%] ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Size: 0KB | Remaining: ${x--}/${totalEpisodes}`

        if (await isPathExists(finalFilePath)) {
            await sleep(100)
            continue
        }

        await ensureDir(tempDir)

        let { url: m3u8RequestUrl } = await fetch.json(episode.url)
        const availableQualities = await fetch.text(m3u8RequestUrl)

        // Automatically downgrade quality when preferred quality not found
        const qualities = Object.values(QUALITY_FORMAT)

        while (!availableQualities.includes(QUALITY) && availableQualities.includes('#EXTM3U')) {
            QUALITY = qualities[qualities.indexOf(QUALITY) - 1]

            if (typeof QUALITY === 'undefined') {
                console.warn(`This shouldn't happen, please fill an issue`)
                console.warn(`Selected Quality: ${PREFERRED_QUALITY}\nCourse: ${COURSE_SLUG}\nm3u8: ${availableQualities}`)
                process.exit()
            }
        }

        if (QUALITY !== PREFERRED_QUALITY) {
            const [formattedQuality] = Object.entries(QUALITY_FORMAT).find(([_, value]) => value === QUALITY)
            spinner.text = `The preferred quality was not found, downgraded to ${formattedQuality}p`
        }

        const m3u8Url = [...m3u8RequestUrl.split('/').slice(0, -1), `${QUALITY}.${PLAYLIST_EXT}`].join('/')

        headers['Cookie'] = await cookies.getCookieString(m3u8Url)

        const progress = new FfmpegProgress()

        progress.on('data', (data) => {
            spinner.text = `Downloading [${data.percentage.toFixed()}%] ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Size: ${formatBytes(data.size)} | Remaining: ${x}/${totalEpisodes}`
        })

        await ffmpeg([
            '-y',
            '-headers', Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n',
            '-i',
            m3u8Url,
            '-map', '0',
            '-c',
            'copy', INCLUDE_CAPTION ? filePath : finalFilePath
        ], {
            pipe: progress,
            silent: true
        })

        x--

        // Insert subtitles
        if (INCLUDE_CAPTION) {
            spinner.text = `Downloading captions for ${episode.title}...`

            const captions = await fetch.text(`${FEM_CAPTIONS_ENDPOINT}/assets/courses/${course.datePublished}-${course.slug}/${episode.index}-${episode.slug}.${CAPTION_EXT}`)

            await fs.writeFile(captionPath, captions)

            spinner.text = `Merging captions to ${episode.title}...`

            if (EXTENSION === 'mkv') {
                await ffmpeg(['-y',
                    '-i', filePath,
                    '-i', captionPath,
                    '-map', '0',
                    '-map', '1',
                    '-c',
                    'copy',
                    finalFilePath
                ], { silent: true })
            } else {
                await ffmpeg(['-y',
                    '-i', filePath,
                    '-i', captionPath,
                    '-c',
                    'copy',
                    '-c:s', 'mov_text',
                    '-metadata:s:s:0', 'language=eng',
                    finalFilePath
                ], { silent: true })
            }
        }
    }

    await fs.rm(lessonTempDir, { force: true, recursive: true })
}


spinner.succeed('Finished')
