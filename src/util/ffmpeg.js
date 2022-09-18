import { execFile } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

export default (...args) => new Promise((resolve, reject) => execFile(ffmpegPath, args, (err, _stdout, _stderr) => {
    err ? reject(err) : resolve()
}))