import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';    

const token = process.env.TOKEN;
const RATELIMIT_THRESHOLD = 5;
const DELAY_NORMAL_MS = 100;
const DELAY_COOLDOWN_MS = 60_000;
const labelsCache = [];
const collectionCache = [];
const labelsCacheFile = 'labels.json';
const collectionCacheFile = 'entrall.json';
let rateLimitRemaining = 60;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getLocation(releaseId){
    console.log('Fetching location for listing ID:', releaseId);

    const response = await fetch(`https://api.discogs.com/marketplace/listings/${releaseId}?token=${token}`);
    const listingData = await response.json();
    console.log(listingData);
    return listingData.location;
}

async function getCollectionNotes(username){
    console.log(`Fetching collection notes for user: ${username}`);
    const cached = await loadLabelsCache(collectionCacheFile);
    const collectionItems = [];
    let reachedAlreadyCached = false;
    let totalPages = 2000;
    collectionCache.push(...cached);
    for(let currentPage=1;currentPage<=totalPages;currentPage++){
        console.log(`Processing collection page ${currentPage} from ${totalPages}...`);
        const releaseCollectionResponse = await fetch(getReleaseCollectionItemURL(username)+currentPage, {
            headers: {
                Authorization: `Discogs token=${token}`,
                'User-Agent': 'test/1.0',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Accept': "application/json",         
            }
        });
        const releaseCollectionData = await releaseCollectionResponse.json();
        totalPages = releaseCollectionData.pagination.pages;

        for(const release of releaseCollectionData.releases){
            const foundInCache = collectionCache.find(item => item.id === release.id);
            if(!foundInCache){
                collectionItems.push({
                    id: release.id,
                    notes: release.notes?.filter(r => r.field_id === 3)[0]?.value || null
                });
            } else {
                reachedAlreadyCached = true;
                break;
            }
            setRateLimitRemaining(releaseCollectionResponse.headers.get('x-discogs-ratelimit-remaining'));
            await rateLimitPrevent();
        }
        
        collectionCache.push(...collectionItems);
        if(reachedAlreadyCached){
            console.log('Reached already cached items, stopping further fetch.');
            break;
        }
    }
    return collectionCache;
}

export function getInventoryUrl(username, releasesToProcess) {
    return `https://api.discogs.com/users/${username}/inventory?token=${token}&per_page=${releasesToProcess<100?releasesToProcess:100}&sort=listed&sort_order=desc`;
}

export function getReleaseCollectionItemURL(username){
    return `https://api.discogs.com/users/${username}/collection/folders/0/releases?per_page=100&page=`;
}

function getStoreNameFromUrl(url) {
    const startString = "\\/users\\/";
    const endString = "\\/inventory\\?";
    const regex = new RegExp(startString + "(.*?)" + endString);

    return url.match(regex)[1];
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function setRateLimitRemaining(remaining) {
    rateLimitRemaining = remaining;
}
async function rateLimitPrevent() {
    return wait(rateLimitRemaining < RATELIMIT_THRESHOLD ? DELAY_COOLDOWN_MS : DELAY_NORMAL_MS);
}

export async function fetchListing(url) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const listings = await response.json();
    return listings;
}

export async function loadLabelsCache(file) {
    const cache = []
    try {
        const filePath = path.join(__dirname, file);
        const data = await fs.promises.readFile(filePath, 'utf8');
        console.log(`Loaded cache from ${file}`);
        const jsonData = JSON.parse(data);
        console.log(jsonData)
        cache.push(...jsonData);
        return cache;
    } catch (err) {
        console.error('Error reading or parsing file:', err);
        return [];
    }
}

export async function fetchReleaseData(resource_url, releaseId, urlInventory) {
    const username = getStoreNameFromUrl(urlInventory);
    const response = await fetch(`${resource_url}?token=${token}`);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    setRateLimitRemaining(response.headers.get('x-discogs-ratelimit-remaining'));
    const releaseData = await response.json();
    await rateLimitPrevent();
    return releaseData;
}

export async function processPage(currentPage, urlInventory) {
    console.log(`Processing page ${currentPage} of inventory...`);
    try{
        const listingsData = await fetchListing(`${urlInventory}&page=${currentPage}`);
        const pageReleases = [];
        for (const listing of listingsData.listings) {
            const { release, price } = listing;
            //console.log('listning:', listing)
            const releaseData = await fetchReleaseData(release.resource_url, release.id, urlInventory);

            const { artist, title, year } = release;
            const { styles, country, labels} = releaseData;

            pageReleases.push(await releaseCard(release.id, artist, title, price, styles, country, year, labels, listing.id));

            await rateLimitPrevent();
        }

        return pageReleases;
    }
    catch(error) {
        console.error('Error fetching inventory:', error);

        return [];
    }
}

export async function getLabelLogo(label) {
    const labelId = label.id;
    const foundLabel = labelsCache.find(l => l.id === labelId);
    if(foundLabel) {
        return foundLabel.src;
    } else {
        const labelResponse = await fetch(`https://api.discogs.com/labels/${labelId}?token=${token}`);
        const labelData = await labelResponse.json();
        const image = labelData.images ? labelData.images[0].uri : null;
        labelsCache.push({ id: labelId, src: image });
        await fs.promises.writeFile('./src/labels.json', JSON.stringify(labelsCache, null, 4));
        await rateLimitPrevent();
        return image;
    }
}

export async function releaseCard(id, artist, title, price, styles, country, year, labels, listningId) {
    console.log(`Processing release ID: ${id} - ${artist} - ${title}`);

    const label = labels[0];
    label.image = await getLabelLogo(label);

    let position = collectionCache.find(item => item.id === id) ? collectionCache.find(item => item.id === id).notes : null;

    if(!position){
        position = await getLocation(listningId)
        collectionCache.map(item => {
            if(item.id === id){
                item.notes = position;
            } return {...item, notes: position}
        });
    }

    return {
        id,
        artist,
        title,
        price: price.value,
        styles: styles.join(', '),
        country,
        year,
        label: {
            name: label.name,
            image: label.image
        },
        position: position || null
    }
}

export async function processInventory(store, qty){
    console.log(`Starting processing inventory for store: ${store} with quantity: ${qty}`);
    if(store.toLowerCase() === 'entrall'){
        await getCollectionNotes(store);
    }
    
    const cards = [];
    const pagesToProcess = Math.ceil(qty / 100);
    const urlInventory = getInventoryUrl(store, qty);
    labelsCache.push(...await loadLabelsCache(labelsCacheFile));

    for(let currentPage = 1;currentPage<=pagesToProcess;currentPage++){
        const releases = await processPage(currentPage, urlInventory);
        cards.push(...releases)
    }

    await fs.promises.writeFile(path.join(__dirname, collectionCacheFile), JSON.stringify(collectionCache, null, 4));
    return cards;
}