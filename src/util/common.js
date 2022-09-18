import fs from 'node:fs/promises'
import fetch from 'node-fetch'

export function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return '0 Bytes'

    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`
}


export function isPathExists(path) {
    return fs.access(path).then(() => true).catch(() => false)
}

export async function ensureDir(path) {
    if (!await isPathExists(path)) {
        await fs.mkdir(path, { recursive: true })
    }
}

export async function ensureEmpty(path) {
    await fs.rm(path, { force: true, recursive: true }).catch(() => null)   
    await fs.mkdir(path, { recursive: true })    
}

export function get(url) {
    return fetch(url).then(res => {
        if (!res.ok) throw res
        return res.arrayBuffer()
    }).then(Buffer.from)
}

export { setTimeout as sleep } from 'node:timers/promises'