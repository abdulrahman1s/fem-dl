
export default class M3u8 {
    constructor(content) {
        content  = content.toString()
        
        this.totalChunks = 0
        this.decryptionKey = content.match(/URI="(.+)"/)[1]
        this.content = content.split('\n')

        for (const line of this.content) if (line.startsWith('index_')) this.totalChunks++
    }

    setDecryptionKey(key) {
        this.decryptionKey = key
        this.content = this.content.join('\n').replace(/URI="(.+)"/g, `URI="${key}"`).split('\n')
        return this
    }

    toString() {
        return this.content.join('\n')
    }
}
