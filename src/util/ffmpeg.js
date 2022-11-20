import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'


export default (args, { silent = false, pipe } = {}) => new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args)
    let err = ''
    
    child.stdout.on('data', (data) => silent || console.log(data.toString()))
    child.stderr.on('data', (data) => silent || (console.log(data.toString()), err += data.toString()))
    
    if (pipe) child.stderr.pipe(pipe)
    
    child.on('exit', (code) => code ? reject(err) : resolve())
})