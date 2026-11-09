const { app } = require('electron');
const path = require('path');

app.setPath('userData', path.join(app.getPath('appData'), 'ShoppingLens'));

app.whenReady().then(async () => {
  const yt = require('../services/ytdlp');
  try {
    const videos = await yt.searchLens('다이소 꿀템', { limit: 5, sort: 'views', shorts: false });
    console.log('videos', videos.length, videos[0] && videos[0].title, videos[0] && videos[0].views);
    const channels = await yt.searchChannels('자취피티', 5);
    console.log('channels', channels.length, channels[0] && channels[0].name, channels[0] && channels[0].url);
    if (channels[0]) {
      const vids = await yt.channelVideos(channels[0].url, 3);
      console.log('channelVideos', vids.length, vids[0] && vids[0].title);
    }
    console.log('OK');
  } catch (e) {
    console.log('FAILED', e.stack || e.message);
  }
  app.quit();
});
