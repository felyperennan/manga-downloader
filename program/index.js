const puppeteer = require('puppeteer-core')
const fs = require('fs')
const utils = require('./utils')
const axios = require('axios')

const delay = (d)=> new Promise((res)=> setTimeout(res, d));

let filas = [];
let simultaneidade = 4;

utils.initDirs();

function setTerminalTitle(title)
{
  process.stdout.write(
    String.fromCharCode(27) + "]0;" + title + String.fromCharCode(7)
  );
}

// Leitura da lista
try {
    filas = fs.readdirSync('../')
    .filter(x=> x.match(/fila-(\w+).txt/g))
    .map(x=> fs.readFileSync('../' + x, 'utf-8'));
    filas = filas.map(x=> 
        x.split('\n')
        .map(x=> x.trim())
        .filter(Boolean)
        .filter(x => {
            try {
                new URL(x);
                return true;
            } catch(err) {
                console.log("URL inválida", x);
                return false;
            }
        })
        .map(x=> {
            let pat = new RegExp(/mangalivre.com\/manga\/([-\w+]*)\/([\d+]*)/g);
            let match = pat.exec(x);
            return utils.getMeta(match[1]) || {
                name: match[1],
                id: match[2],
                url: x
            }
        })
        .filter(Boolean)
    );
    
} catch(err) {
    console.log('Erro ao ler a lista', err);
    return;
}
// // ---

puppeteer.launch({
    headless: false,
    executablePath: '/usr/bin/chrome-browser'
}).then(async browser => {
    let lista = [];
    while(filas.find(f=> f.length > 0)) {
        filas.forEach(f=> {
            if(f.length) {
                lista.push(f.shift());
            }
        });
    }

    let promises = [];
    let finished = 0;
    do {
        finished += promises.reduce((a,p)=> a + (p.fulfilled ? 1: 0), 0);
        promises = promises.filter(p=> !p.fulfilled);
        let spawnNew = [];
        while((promises.length + spawnNew.length) < simultaneidade && lista.length > 0) {
            spawnNew.push(lista.shift());
        }
        newPromises = spawnNew.map(
            manga => {
                let promise = new Promise (async res=> {
                    console.log('Blz, trabalhando em ', manga.name)
                    if(!manga.chapters) {
                        console.log('Buscando os capitulos...')
                        const page = await browser.newPage();
                        
                        await page._client.send('Network.setBypassServiceWorker', {bypass: true})
                        const client = await page.target().createCDPSession();
                        await client.send('Network.clearBrowserCookies');
                        await client.send('Network.clearBrowserCache');

                        await page.setRequestInterception(true);
                        let grab = new Promise(res=> {
                            let to;
                            let chapsRes = [];
                            page.on('request', request => {
                                if (request.url().indexOf('https://mangalivre.com') !== 0 || request.resourceType() === 'image') {
                                    request.abort();
                                    return;
                                }
                                request.continue();
                                let url = request.url();
                                let idx = url.indexOf('chapters_list.json');
                                if(idx > -1) {
                                    to && clearTimeout(to) && (to = null);
                                }
                            });
                            page.on('requestfinished', async request => {
                                let url = request.url();
                                let idx = url.indexOf('chapters_list.json');
                                if(idx > -1) {
                                    to && clearTimeout(to) && (to = null);
                                    request.response().text()
                                        .then(response => {
                                            let responseData = JSON.parse(response);
                                            if(responseData.chapters) {
                                                responseData.chapters.map((x)=>
                                                    ({
                                                        url: x.releases[Object.keys(x.releases)[0]].link,
                                                        id: x.id_chapter,
                                                        name: `Capitulo ${x.number}-${x.chapter_name.replace(/\W+/g, '_')}`,
                                                        number: Number(x.number)
                                                    })
                                                ).forEach(x=> chapsRes.push(x));
                                            }
                                        });
                                    await delay(500);
                                    await page.evaluate(()=> window.scrollBy(0, 10000));
                                    to = setTimeout(()=> {
                                        res(chapsRes);
                                    }, 5000)
                                }
                            });
                        });
                        await page.goto(manga.url, {
                            waitUntil: 'networkidle0',
                            timeout: 0
                        });

                        manga.title = await page.evaluate(()=> document.querySelector('#series-data .series-title').textContent);
                        manga.description = await page.evaluate(()=> document.querySelector('#series-data .series-desc').textContent);
                        manga.coverUrl = await page.evaluate(()=> document.querySelector('#series-data .cover img').getAttribute('src'));
                        let coverFile = `../downloads/${manga.name}/cover.jpg`;
                        if(!fs.existsSync(`../downloads/${manga.name}`)) {
                            fs.mkdirSync(`../downloads/${manga.name}`, { recursive: true});
                        }
                        
                        manga.chapters = (await grab)
                        .filter(Boolean)
                        .sort((a,b) => a.number > b.number ? 1 : a.number < b.number ? -1 : 0);
                        utils.saveMeta(manga);
                        console.log('Achou os capitulos, total', manga.chapters.length);
                        await page.close();
                    }
            
                    await utils.asyncForEach(manga.chapters, async (chapter, i) => {
                        setTerminalTitle(`Baixando ${promises.length} ${finished} concluidos ${lista.length + promises.length} restantes`);
                        console.log(`[${manga.name}] ${chapter.name}`);
                        if(!chapter.images) {
                            const page = await browser.newPage();
                            
                            await page._client.send('Network.setBypassServiceWorker', {bypass: true})
                            const client = await page.target().createCDPSession();
                            await client.send('Network.clearBrowserCookies');
                            await client.send('Network.clearBrowserCache');
            
                            await page.setRequestInterception(true);
                            
                            let grabImages = new Promise(res=> {
                                page.on('request', async request => {
                                    if (request.url().indexOf('https://mangalivre.com') !== 0 || request.resourceType() === 'image') {
                                        request.abort();
                                        return;
                                    }
                                    request.continue();
                                });
            
                                page.on('requestfinished', request => {
                                    let url = request.url();
                                    let idx = url.indexOf('.json?key=');
                                    if(idx > -1) {
                                        request.response().text()
                                            .then(response => {
                                                let responseData = JSON.parse(response);
                                                res(responseData);
                                                page.close().catch(()=>{});
                                            });
                                    }
                                });
                            })
            
                            page.goto('https://mangalivre.com' + chapter.url).catch(err=> {});
            
                            chapter.images = (await grabImages);
                            await page.close();
                            chapter.images = Array.from(chapter.images.images)
                                .map((img, i) => ({
                                    idx: i,
                                    url: img
                                }))
                                // .filter(Boolean);
                            utils.saveMeta(manga);
                        }
                        
                        await utils.asyncForEach(chapter.images, async (img, i)=> {
                            let q = img.url;
                            let dir = `../downloads/${manga.name}/${chapter.name}`;
                            if(!fs.existsSync(dir)) {
                                fs.mkdirSync(dir, { recursive: true });
                            }
                            let fileName = `${img.idx}` + q.substring(q.lastIndexOf('.'));
                            let file = `${dir}/${fileName}`;
                            console.log(`[${manga.name}] ${chapter.name} ${i+1}/${chapter.images.length}`);
                            if(!fs.existsSync(file)) {
                                try {
                                    let remoteResponse = await axios.get(q, {
                                        responseType: 'arraybuffer'
                                    });
                                    let buff = Buffer.from(remoteResponse.data, 'binary')
                                    fs.writeFileSync(file, buff);
                                } catch(err) {
                                    console.log('Não conseguiu baixar', file);
                                }
                            }
                        });
                    })
                    promise.fulfilled = true;
                    res();
                })
                return promise
            }
        )
        while(newPromises.length) promises.push(newPromises.shift());
        await Promise.race(promises);
    } while(lista.length > 0 || promises.length > 0);

    console.log("ue, terminou tudo!");
    browser.close();

});

