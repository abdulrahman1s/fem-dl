
export class M3u8 {
    constructor(content) {
        content  = content.toString()
        
        this.totalChunks = 0
        this.decryptionKey = content.match(/URI="(.+)"/)[1]
        this.content = content.split('\n')

        for (const line of this.content) {
            if (!line.startsWith('#')) this.totalChunks++
        }
    }

    setDecryptionKey(key) {
        this.decryptionKey = key
        this.content = this.content.join('\n').replace(/URI="(.+)"/g, `URI="${key}"`).split('\n')
        return this
    }

    formatChunks(fn) {
        for (let i = 0; i < this.content.length; i++) {
            if (this.content[i].startsWith('index_')) this.content[i] = fn(this.content[i])
        }
        return this
    }

    toString() {
        return this.content.join('\n')
    }
}