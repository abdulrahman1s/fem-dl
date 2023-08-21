#!/usr/bin/env node
import { FfmpegProgress } from '@dropb/ffmpeg-progress'
import extendFetchCookie from 'fetch-cookie'
import colors from 'kleur'
import fs from 'node:fs/promises'
import https, { Agent } from 'node:https'
import ora from 'ora'
import { CAPTION_EXT, FEM_API_ENDPOINT, FEM_CAPTIONS_ENDPOINT, FEM_ENDPOINT, PLAYLIST_EXT, QUALITY_FORMAT, USER_AGENT } from './constants.js'
import { ensureDir, extendedFetch, formatBytes, getIndexMapping, isPathExists, safeJoin, sleep } from './util/common.js'
import ffmpeg from './util/ffmpeg.js'
import { defaultPrompts, selectLessonsPrompt } from './util/prompt.js'

console.clear()

https.globalAgent = new Agent({ keepAlive: true })

const {
    COURSE_SLUG,
    PREFERRED_QUALITY,
    DOWNLOAD_DIR,
    EXTENSION,
    INCLUDE_CAPTION,
    DOWNLOAD_SPECIFIC_LESSON,
    TOKEN
} = await defaultPrompts();

console.clear()

const headers = {
    'User-Agent': USER_AGENT,
    'Origin': 'https://frontendmasters.com',
    'Referer': 'https://frontendmasters.com/'
}

const cookies = new extendFetchCookie.toughCookie.CookieJar()

await cookies.setCookie(`fem_auth_mod=${TOKEN}; Path=/; Domain=frontendmasters.com; HttpOnly; Secure`, FEM_ENDPOINT)

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

const [lessons, episodeCount] = course.lessonElements.reduce((acc, cur) => {
    if (typeof cur === 'string') (acc[0][cur] = [], acc[2] = cur)
    else (acc[0][acc[2]].push(cur), acc[1]++)
    return acc
}, [{}, 0, ''])


let x = 0, QUALITY = PREFERRED_QUALITY, downgradeAlert = false

const coursePath = safeJoin(DOWNLOAD_DIR, course.title)

const lessonIndexMap = getIndexMapping(Object.keys(lessons));

let selectedLessons = lessons;
let totalEpisodes = episodeCount;

if (DOWNLOAD_SPECIFIC_LESSON) {
    spinner.text = 'Waiting for selection..';
    const selectedLessonNames = await selectLessonsPrompt(Object.keys(lessons));
    if (!selectedLessonNames.length) {
        spinner.fail("You haven't selected any lesson to dowload");
        process.exit(0);
    }
    selectedLessons = {};
    totalEpisodes = 0;
    for (let selectedLessonName of selectedLessonNames) {
        selectedLessons[selectedLessonName] = lessons[selectedLessonName];
        totalEpisodes += lessons[selectedLessonName].length; 
    }
}


for (const [lesson, episodes] of Object.entries(selectedLessons)) {
    const i = lessonIndexMap[lesson] + 1;
    const
        lessonName = `${i}. ${lesson}`,
        lessonPath = safeJoin(coursePath, lessonName)

    await ensureDir(lessonPath)

    for (const episode of episodes) {
        const
            fileName = `${episode.index + 1}. ${episode.title}.${EXTENSION}`,
            captionPath = safeJoin(lessonPath, `${episode.title}.${CAPTION_EXT}`),
            tempFilePath = safeJoin(lessonPath, `${episode.title}.tmp.${EXTENSION}`),
            finalFilePath = safeJoin(lessonPath, fileName)

        spinner.text = `[0%] Downloading ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Size: 0KB | Remaining: ${++x}/${totalEpisodes}`

        if (await isPathExists(finalFilePath)) {
            await sleep(100)
            continue
        }


        let { url: m3u8RequestUrl } = await fetch.json(episode.url)
        const availableQualities = await fetch.text(m3u8RequestUrl)

        // Automatically downgrade quality when preferred quality not found
        const qualities = Object.values(QUALITY_FORMAT)

        while (!QUALITY.some((it) => availableQualities.includes(it)) && availableQualities.includes('#EXTM3U')) {
            const index = qualities.findIndex(it => it.every(q => QUALITY.includes(q)))

            QUALITY = qualities[index - 1]

            if (typeof QUALITY === 'undefined') {
                console.warn(`This shouldn't happen, please fill an issue`)
                console.warn(`Selected Quality: ${PREFERRED_QUALITY}\nCourse: ${COURSE_SLUG}\nm3u8: ${availableQualities}`)
                process.exit()
            }
        }

        if (!downgradeAlert && !PREFERRED_QUALITY.some(it => QUALITY.includes(it))) {
            downgradeAlert = true
            const [formattedQuality] = Object.entries(QUALITY_FORMAT).find(([_, it]) => it.every(q => QUALITY.includes(q)))
            spinner.clear()
            console.log(`\nThe preferred quality was not found, downgraded to ${formattedQuality}p`)
        }

        const streamQuality = QUALITY.find(it => availableQualities.includes(it))
        const m3u8Url = [...m3u8RequestUrl.split('/').slice(0, -1), `${streamQuality}.${PLAYLIST_EXT}`].join('/')

        headers['Cookie'] = await cookies.getCookieString(m3u8Url)

        const progress = new FfmpegProgress()

        progress.on('data', (data) => {
            if (data.percentage && data.size) spinner.text = `[${data.percentage.toFixed()}%] Downloading ${colors.red(lessonName)}/${colors.cyan().bold(fileName)} | Size: ${formatBytes(data.size)} | Remaining: ${x}/${totalEpisodes}`
        })

        await ffmpeg([
            '-y',
            '-headers', Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n') + '\r\n',
            '-i',
            m3u8Url,
            '-map', '0',
            '-c',
            'copy', tempFilePath
        ], {
            pipe: progress,
            silent: true
        })


        // Merge caption
        if (INCLUDE_CAPTION) {
            spinner.text = `Downloading captions for ${episode.title}...`

            const captions = await fetch.text(`${FEM_CAPTIONS_ENDPOINT}/assets/courses/${course.datePublished}-${course.slug}/${episode.index}-${episode.slug}.${CAPTION_EXT}`)

            await fs.writeFile(captionPath, captions)

            spinner.text = `Merging captions to ${episode.title}...`

            let args = []

            switch (EXTENSION) {
                case 'mkv': args = [
                    '-y',
                    '-i', tempFilePath,
                    '-i', captionPath,
                    '-map', '0',
                    '-map', '1',
                    '-c',
                    'copy',
                    finalFilePath
                ]; break

                case 'mp4': args = [
                    '-y',
                    '-i', tempFilePath,
                    '-i', captionPath,
                    '-c',
                    'copy',
                    '-c:s', 'mov_text',
                    '-metadata:s:s:0', 'language=eng',
                    finalFilePath
                ]; break;
                default:
                    throw new Error(`Unknown extension found: ${EXTENSION}`)
            }

            await ffmpeg(args, { silent: true })
            await fs.rm(captionPath)
        } else {
            await fs.copyFile(tempFilePath, finalFilePath)
        }

        await fs.rm(tempFilePath).catch(() => null)
    }
}


spinner.succeed('Finished')
