import defaultFetch from 'node-fetch'
import extendFetchCookie from 'fetch-cookie'
import extendFetchRetry from 'fetch-retry'
import fs from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'



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

export function extendedFetch(options, cookies) {
	let actualFetch = defaultFetch

	actualFetch = extendFetchCookie(actualFetch, cookies)
	actualFetch = extendFetchRetry(actualFetch)

	const fetch = (url, returnType) => actualFetch(url, options).then((res) => {
		if (!res.ok) throw res
		if (returnType === 'json') return res.json()
		if (returnType === 'text') return res.text()
		if (returnType === 'binary') return res.arrayBuffer().then(Buffer.from)
		return res
	})

	fetch.json = (url) => fetch(url, 'json')
	fetch.text = (url) => fetch(url, 'text')
	fetch.binary = (url) => fetch(url, 'binary')
	fetch.raw = (url) => fetch(url)

	return fetch
}



export function safeJoin(...path) {
	const regex = os.platform() === 'win32' ? /[\/\\:*?"<>|]/g : /(\/|\\|:)/g
	path[path.length - 1] = path[path.length - 1].replace(regex, '')
	return join(...path)
}


export { setTimeout as sleep } from 'node:timers/promises'

/**
 * Create element to index mapping
 * @param {string[]} arr Array of strings
 * @returns {object}
 */
export const getIndexMapping = (arr = []) => arr.reduce((acc, curr, index) => {
	acc[curr] = index;
	return acc;
}, {});
