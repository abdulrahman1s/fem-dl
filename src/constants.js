const FEM_BASE = 'frontendmasters.com'

export const FEM_ENDPOINT = `https://${FEM_BASE}`
export const FEM_API_ENDPOINT = `https://api.${FEM_BASE}/v1`
export const FEM_CAPTIONS_ENDPOINT = `https://captions.${FEM_BASE}`
export const PLAYLIST_EXT = 'm3u8'
export const CAPTION_EXT = 'vtt'
export const QUALITY_FORMAT = {
    2160: 'index_2160p_Q10_20mbps',
    1440: 'index_1440p_Q10_9mbps',
    1080: 'index_1080_Q8_7mbps',
    720: 'index_720_Q8_5mbps',
    360: 'index_360_Q8_2mbps'
}

export const FEM_COURSE_REG = /(:?https?:\/\/)?frontendmasters\.com\/courses\/([^/]+)/

export const SUPPORTED_FORMATS = [
    'mp4',
    'mkv'
]


export const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36'
