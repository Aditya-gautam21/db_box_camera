import onvif from 'node-onvif';
import ffmpeg from 'fluent-ffmpeg';
import { fileURLToPath } from 'url';
import path from 'path';

// Recreate __dirname functionality for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Connection Configurations
const CAMERA_IP = '192.168.1.2'; 
const USERNAME = 'admin';
const PASSWORD = 'admin';

// 2. DEFINE YOUR CUSTOM CLIP WINDOW (Must be in UTC time / ISO Format)
// Example: August 19, 2026, from 10:00 AM to 10:15 AM UTC
const START_TIME = '2026-08-19T10:00:00.000Z';
const END_TIME   = '2026-08-19T10:00:30.000Z';
const OUTPUT_FILE = path.join(__dirname, 'sd_card_clip.mp4');

async function downloadSdCardClip() {
  const device = new onvif.OnvifDevice({
    xaddr: `http://${CAMERA_IP}:80/onvif/device_service`,
    user: USERNAME,
    pass: PASSWORD
  });

  try {
    console.log('Connecting to camera ONVIF service...');
    await device.init();

    // Get the primary video profile token
    const profile = device.getCurrentProfile();
    const profileToken = profile['token'];
    console.log(`Using Media Profile Token: ${profileToken}`);

    console.log('Requesting custom playback stream from SD card...');
    
    // Fallback standard ONVIF replay string formatting on Port 554
    let replayUrl = `rtsp://${USERNAME}:${PASSWORD}@${CAMERA_IP}:554/onvif_playback?starttime=${START_TIME.replace(/[-:]/g, '').split('.')}Z`;
    
    // Attempt dynamic ONVIF Replay service retrieval if exposed by the firmware
    if (device.services.replay) {
       const uriData = await device.services.replay.getReplayUri({
         StreamSetup: { Stream: 'RTP-Unicast', Transport: { Protocol: 'RTSP' } },
         RecordingToken: profileToken
       });
       if (uriData && uriData.Uri) {
         replayUrl = uriData.Uri.replace('rtsp://', `rtsp://${USERNAME}:${PASSWORD}@`);
       }
    }

    console.log(`Targeting Replay URL: ${replayUrl}`);
    console.log('Initializing network transfer to laptop...');

    // Calculate duration in seconds for FFmpeg cutting
    const durationInSeconds = (new Date(END_TIME) - new Date(START_TIME)) / 1000;

    // 3. Pass the custom time-bounded stream to FFmpeg
    ffmpeg(replayUrl)
      .inputOptions([
        '-rtsp_transport tcp'
      ])
      .outputOptions([
        `-t ${durationInSeconds}`, // Hard stop when the custom clip window ends
        '-c copy'                  // Lossless direct copy (keeps native resolution)
      ])
      .output(OUTPUT_FILE)
      .on('start', (cmd) => {
        console.log(`Downloading video segment (${durationInSeconds} seconds total)...`);
      })
      .on('progress', (progress) => {
        console.log(`Processing... Timemark: ${progress.timemark}`);
      })
      .on('end', () => {
        console.log(`\n🎉 Success! Custom clip saved via ES Modules to: ${OUTPUT_FILE}`);
        process.exit(0);
      })
      .on('error', (err) => {
        console.error('Download failed. Verify timeline ranges and Profile G network compliance:', err.message);
        process.exit(1);
      })
      .run();

  } catch (error) {
    console.error('ONVIF Connection or Setup error:', error);
  }
}

downloadSdCardClip();
