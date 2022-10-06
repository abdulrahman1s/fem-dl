#!/usr/bin/env node

console.clear()

import { FEM_API_ENDPOINT, FEM_CAPTIONS_ENDPOINT, CAPTION_EXT, PLAYLIST_EXT, QUALITY_FORMAT, FEM_COURSE_REG, SUPPORTED_FORMATS } from './constants.js'
import { sleep, isPathExists, ensureDir, extendedFetch, safeJoin } from './util/common.js'
import ffmpeg from './util/ffmpeg.js'
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
    PREFERED_QUALITY,
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
    name: 'PREFERED_QUALITY',
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


const fetch = extendedFetch({
    headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
        'Cookie': `wordpress_logged_in_323a64690667409e18476e5932ed231e=${TOKEN}`,
        'Origin': 'https://frontendmasters.com',
        'Referer': 'https://frontendmasters.com/',
    },
    retries: 5,
    retryDelay: 1000
})

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


let i = 1, x = totalEpisodes, QUALITY = PREFERED_QUALITY

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

        let { url: m3u8RequestUrl } = await fetch.json(episode.url)
        const availableQualities = await fetch.text(m3u8RequestUrl)

        // Automatically downgrade quality when preferred quality not found
        const qualities = Object.values(QUALITY_FORMAT)
        while (!availableQualities.includes(QUALITY) && availableQualities.includes('#EXTM3U')) {
            QUALITY = qualities[qualities.indexOf(QUALITY) - 1]

            if (typeof QUALITY === 'undefined') {
                console.warn(`This shouldn't happen, please fill an issue`)
                console.warn(`Selected Quality: ${PREFERED_QUALITY}\nCourse: ${COURSE_SLUG}\nm3u8: ${availableQualities}`)
                process.exit()
            }
        }

        if (QUALITY !== PREFERED_QUALITY) {
            const [formattedQuality] = Object.entries(QUALITY_FORMAT).find(([_, value]) => value === QUALITY)
            spinner.text = `The preferred quality was not found, downgraded to ${formattedQuality}p`
        }


        const
            m3u8Url = [...m3u8RequestUrl.split('/').slice(0, -1), `${QUALITY}.${PLAYLIST_EXT}`].join('/'),
            m3u8 = await fetch.text(m3u8Url),
            key = await fetch.binary(m3u8.match(/URI="(.+)"/)[1])

        await Promise.all([
            fs.writeFile(decryptionKeyPath, key),
            fs.writeFile(playlistPath, m3u8.replace(/URI="(.+)"/g, 'URI="key.bin"'))
        ])

        const totalChunks = m3u8.split('\n').reduce((a, c) => c.startsWith('index_') ? a + 1 : a, 0)

        for (let j = 0; j < totalChunks; j++) {
            const
                chunkName = `${QUALITY}_${(j + 1).toString().padStart(5, '0')}.ts`,
                chunkPath = safeJoin(tempDir, chunkName),
                chunkUrl = [...m3u8Url.split('/').slice(0, -1), chunkName].join('/')

            if (await isPathExists(chunkPath)) {
                continue
            }

            const chunk = await fetch.binary(chunkUrl)

            await fs.writeFile(chunkPath, chunk)

            spinner.text = `Downloading ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Chunks: ${j + 1}/${totalChunks} | Remaining: ${x + 1}/${totalEpisodes}`
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
            spinner.text = 'Downloading subtitles...'

            const captions = await fetch.text(`${FEM_CAPTIONS_ENDPOINT}/assets/courses/${course.datePublished}-${course.slug}/${episode.index}-${episode.slug}.${CAPTION_EXT}`)
            await fs.writeFile(captionPath, captions)

            spinner.text = 'Inserting subtitles...'

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


spinner.succeed('Finished')
