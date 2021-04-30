const fs = require('fs');
const OJS = require('owop-js');
const PNG = require('pngjs').PNG;

if (process.argv.length != 7) {
    showUsage();
}

const worldName = process.argv[2];
const pixelRootX = Math.floor(Number(process.argv[3]));
const pixelRootY = Math.floor(Number(process.argv[4]));
const imageHeight = Math.floor(Number(process.argv[5]));
const imageWidth  = Math.floor(Number(process.argv[6]));

// Ur stupid if u get this error, images cant be negative in size
if (imageHeight <= 0 || imageWidth <= 0) {
    console.error('Image height/width cannot be negative!');
    showUsage();
}

// Should be 16x16
const chunkSize = OJS.Client.options.chunkSize;

// Image dimensions in chunks
const imageChunksV = Math.floor(imageHeight / chunkSize);
const imageChunksH = Math.floor(imageWidth / chunkSize);
const imageChunksTotal = imageChunksH * imageChunksV;

// Image root coordinates in chunk positions
const chunkRootX = Math.floor(pixelRootX / chunkSize);
const chunkRootY = Math.floor(pixelRootY / chunkSize);

// How many chunks we have drawn to the canvas
var readChunks = 0;

// Boolean array to keep track of which chunks we have written
var bmap = new Array(imageChunksTotal);
bmap.fill(true);

// Canvas to write the chunks to
var canvas = new PNG({
    width:  imageWidth,
    height: imageHeight,
    colorType: 6 // RGB, no transparency
});

// OWOP client
var client = new OJS.Client({
    reconnect: true,
    controller: true,
    world: worldName
});

client.once('join', start);
client.on('chunk', paintChunk);

// main function
async function start() {
    process.stdout.clearLine();
    console.log('Requesting and painting ' + imageChunksTotal + ' chunks...');
    requestChunks();
    await awaitFinishedCanvas();

    let dirname = 'renders';

    if (!fs.existsSync(dirname)){
        fs.mkdirSync(dirname);
    }

    let filename = worldName + '_' + imageHeight + 'x' + imageWidth + '_' + pixelRootX + '-' + pixelRootY + '_';

    console.log('\nSaving canvas as "' + filename + '"');
    fs.writeFileSync(dirname + '/' + filename + '.png', PNG.sync.write(canvas, { colorType: 2 }));

    console.log('Done!');
    process.exit(0);
}

// Request all the chunks in our target area
async function requestChunks() {
    while (!checkAllDrawn()) {
        for (let cy = 0; cy < imageChunksV; ++cy) {
            for (let cx = 0; cx < imageChunksH; ++cx) {
                if (shouldDrawChunk(cx, cy)) {
                    try {
                        // If we are disconnected from the map, then wait until we reconnect
                        while(!client.net.isWebsocketConnected || !client.net.isWorldConnected) await timeout(5);

                        client.world.requestChunk(chunkRootX + cx, chunkRootY + cy).catch(err => { --cx; });

                        // We dont wanna be rate limited
                        await timeout(1);
                    } catch(e) { --cx; } // If we get an exception, go back a step and try again
                }
            }
        }
    }
}

// Wait until all chunks have been drawn onto the canvas
async function awaitFinishedCanvas() {
    while (imageChunksTotal > readChunks) {
        await timeout(50);
    }
}

// This paints chunks to the canvas
async function paintChunk(cx, cy, raw, protected) {
    // Stupid stuff to avoid re-drawing chunks
    if (shouldDrawChunk(cx - chunkRootX, cy - chunkRootY)) {

        // Index of chunk array
        let idx = 0;

        // Get chunk pixel-position
        let cpx = (cx * chunkSize) - pixelRootX;
        let cpy = (cy * chunkSize) - pixelRootY;

        // For every pixel of the chunk, draw them to the canvas at a calculated offset
        for (let py = 0; py < chunkSize; ++py) {
            for (let px = 0; px < chunkSize; ++px) {
                let r = raw[idx++];
                let g = raw[idx++];
                let b = raw[idx++];

                setPixel(r, g, b, cpx + px, cpy + py);
            }
        }

        // Register the current chunk as drawn
        setChunkDrawn(cx - chunkRootX, cy - chunkRootY);

        // Increment the amount of read chunks, and print the current progress
        printProgress(++readChunks / imageChunksTotal);
    }
}

// Draws a pixel to the canvas
async function setPixel(r, g, b, x, y) {
    let idx = (imageWidth * y + x) << 2;

    canvas.data[idx + 0] = r;
    canvas.data[idx + 1] = g;
    canvas.data[idx + 2] = b;
    canvas.data[idx + 3] = 255;
}

// Timeout thingy
function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Prints progress without spamming the console with newlines
async function printProgress(value) {
    process.stdout.clearLine();
    process.stdout.cursorTo(0);
    process.stdout.write('Canvas is ' + parseFloat(value * 100).toFixed(2) + '% complete');
    process.stdout.cursorTo(26);
}

// Thing that checks if a chunk sgould be drawn (useful for failed chunks, so that the main loop can re-request them)
function shouldDrawChunk(cx, cy) {
    return bmap[(imageChunksV * cy) + cx];
}
function setChunkDrawn(cx, cy) {
    bmap[(imageChunksV * cy) + cx] = false;
}
function checkAllDrawn() {
    for (let i = 0; i < imageChunksTotal; i++) {
        if (bmap[i]) {
          return false;
        }
    }

    return true;
}

// Help message
function showUsage() {
    console.log('USAGE:\n\tnode mapper.js [world_name] [x_pos] [y_pos] [height] [width]\n\tImages will be put in a "screenshots" folder');
    process.exit(1);
}
