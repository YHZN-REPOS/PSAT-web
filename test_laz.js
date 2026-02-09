
import { load } from '@loaders.gl/core';
import { LASLoader } from '@loaders.gl/las';
import fs from 'fs';

const filePath = '/Users/gmet/Desktop/测试标注软件点云sample/220kV汉郑_#001_labeled.laz';

console.log(`Checking file existence: ${filePath}`);
if (!fs.existsSync(filePath)) {
    console.error('File not found!');
    process.exit(1);
}
console.log('File found. Size:', fs.statSync(filePath).size);

async function testLoad() {
    console.log(`Starting load via loaders.gl...`);
    try {
        const buffer = fs.readFileSync(filePath);
        // Convert Node Buffer to ArrayBuffer
        const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

        console.time('Load Duration');
        const data = await load(arrayBuffer, LASLoader, {
            las: {
                skip: 1 // Read every point (1 = step size 1)
            },
            worker: false // Use main thread
        });
        console.timeEnd('Load Duration');

        console.log('Data Keys:', Object.keys(data));
        if (data.header) console.log('Header Keys:', Object.keys(data.header));

        console.log('--- HEADERS ---');
        console.log('Total Points:', data.header.totalPoints);
        console.log('Version:', data.header.versionAsString);
        console.log('Bounds (Min):', data.header.mins);
        console.log('Bounds (Max):', data.header.maxs);
        console.log('Scale:', data.header.scale);
        console.log('Offset:', data.header.offset);

        console.log('--- ATTRIBUTES ---');
        Object.keys(data.attributes).forEach(key => {
            const attr = data.attributes[key];
            console.log(`${key}: length=${attr.value.length}, type=${attr.value.constructor.name}`);
            // Check first few values
            if (attr.value.length > 0) {
                console.log(`   Sample [0]:`, attr.value[0]);
            }
        });

        console.log('\n✅ File is valid and parsable by loaders.gl.');
    } catch (err) {
        console.error('\n❌ FAILED to load file:', err);
    }
}

testLoad();
