const fs = require('fs');
const OJS = require('owop-js');
const PNG = require('pngjs').PNG;

// Disregard the two first aguments, theire stupid
var argc = process.argv.length - 2;
if (argc != 5) {
    showUsage();
}

// The arguments that actually matter
var argv = process.argv.slice(2);

// Parse all other args except the first one because that the server name
var argv_int = parseArgsAsInts(argv.slice(1), argc);

// Ur stupid if u get this error, images cant be negative in size
if (argv_int[2] <= 0 || argv_int[3] <= 0) {
    console.error('Image height/width cannot be negative!');
    showUsage();
}

// Declare a bunch of constants that imma need later
const root_x = argv_int[0];
const root_y = argv_int[1];
const imageHeight = argv_int[2];
const imageWidth  = argv_int[3];

// Should be 16x16
const chunkSize = OJS.Client.options.chunkSize;

// Image dimensions in chunks
const imageChunksV = Math.floor(imageHeight / chunkSize);
const imageChunksH = Math.floor(imageWidth / chunkSize);
const imageChunksTotal = imageChunksH * imageChunksV;

// Image root coordinates in chunk positions
const root_cx = Math.floor(root_x / chunkSize);
const root_cy = Math.floor(root_y / chunkSize);

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
    world: argv[0]
});

client.once('join', start);
client.on('chunk', paintChunk);

// main function
async function start() {
    process.stdout.clearLine();
    console.log('Requesting and painting ' + imageChunksTotal + ' chunks...');
    requestChunks();
    await awaitFinishedCanvas();

    var filename = 'screenshots/canvas_' + imageHeight + 'x' + imageWidth + '_' + root_x + '-' + root_y + '.png';

    console.log('\nSaving canvas as "' + filename + '"');
    fs.writeFileSync(filename, PNG.sync.write(canvas, { colorType: 2 }));

    console.log('Done!');
    process.exit(0);
}

// Request all the chunks in our target area
async function requestChunks() {
    while (!checkAllDrawn()) {
        for (var cy = 0; cy < imageChunksV; ++cy) {
            for (var cx = 0; cx < imageChunksH; ++cx) {
                if (shouldDrawChunk(cx, cy)) {
                    try {
                        // If we are disconnected from the map, then wait until we reconnect
                        while(!client.net.isWebsocketConnected || !client.net.isWorldConnected) await timeout(5);

                        client.world.requestChunk(root_cx + cx, root_cy + cy).catch(err => { --cx; });

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
    if (shouldDrawChunk(cx - root_cx, cy - root_cy)) {

        // Index of chunk array
        var idx = 0;

        // Get chunk pixel-position
        var cpx = (cx * chunkSize) - root_x;
        var cpy = (cy * chunkSize) - root_y;

        // For every pixel of the chunk, draw them to the canvas at a calculated offset
        for (var py = 0; py < chunkSize; ++py) {
            for (var px = 0; px < chunkSize; ++px) {
                var r = raw[idx++];
                var g = raw[idx++];
                var b = raw[idx++];

                setPixel(r, g, b, cpx + px, cpy + py);
            }
        }

        // Register the current chunk as drawn
        setChunkDrawn(cx - root_cx, cy - root_cy);

        // Increment the amount of read chunks, and print the current progress
        printProgress(++readChunks / imageChunksTotal);
    }
}

// Draws a pixel to the canvas
async function setPixel(r, g, b, x, y) {
  var idx = (imageWidth * y + x) << 2;

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
    for (var i = 0; i < imageChunksTotal; i++) {
        if (bmap[i]) {
          return false;
        }
    }

    return true;
}

// Help message
function showUsage() {
    console.log('USAGE:\n\tnode mapper.js [world_name] [x_pos] [y_pos] [height] [length]\n\tImages will be put in a "screenshots" folder');
    process.exit(1);
}

// Stupid int parser
function parseArgsAsInts(argv, argc) {
    var i = 0;
    var ints = new Array(argc);

    try {
        for (; i < argc; ++i) {
            ints[i] = Math.floor(Number(argv[i]));
        }
    } catch (e) {
        console.error('Error: ' + argv[i] + ' is not a valid integer');
        showUsage();
    }

    return ints;
}
