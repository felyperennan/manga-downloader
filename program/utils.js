const fs = require('fs')

const METANAME = (manga)=> `./meta/${manga}.json`;

class Utils {

    async asyncForEach(array, callback) {
        for (let index = 0; index < array.length; index++) {
            await callback(array[index], index, array);
        }
    }

    async asyncMap(array, callback) {
        let retv = []
        for (let index = 0; index < array.length; index++) {
            retv.push(await callback(array[index], index, array));
        }

        return retv;
    }

    initDirs() {
        if(!fs.existsSync('../downloads')) {
            fs.mkdirSync('../downloads');
        }
        if(!fs.existsSync('./meta')) {
            fs.mkdirSync('./meta');
        }
    }

    hasMeta(manga) {
        return fs.existsSync(METANAME(manga));
    }

    getMeta(manga) {
        if(fs.existsSync(METANAME(manga))) {
            try {
                return JSON.parse(fs.readFileSync(METANAME(manga), 'utf8'));
            } catch(err) {
                
            }
        }
        return null;
    }
    saveMeta(x) {
        fs.writeFileSync(METANAME(x.name), JSON.stringify(x, null, 4), 'utf8');
    }

    async getChapters(browser, x) {
    }
 
    async disableImages(page) {
        
    }
}

module.exports = new Utils();