// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
  github: {
    owner: 'leone337',  // Your GitHub username
    repo: 'DJ-Burt-WebPlayerTest',  // Your repo name
    branch: 'main'  // Usually 'main' or 'master'
  },
  
  folders: {
    music: 'audio/music',
    intros: 'audio/intros',
    specific_intros: 'audio/specific-intros',
    outros: 'audio/outros',
    specific_outros: 'audio/specific-outros',
    jokes: 'audio/jokes',
    stories: 'audio/stories',
    blurbs: 'audio/blurbs',
    announcements: 'audio/announcements'
  },
  
  settings: {
    jokeChance: 15,
    storyChance: 15,
    blurbChance: 10,
    nothingChance: 60,
    announcementIntervalMinutes: 15
  }
};

// ========================================
// GLOBAL STATE
// ========================================
let audioPlayer = null;
let isPlaying = false;
let currentTrackIndex = 0;
let playlist = [];

// Content pools (populated from GitHub)
let pools = {
  music: [],
  intros: [],
  specific_intros: {},
  outros: [],
  specific_outros: {},
  jokes: [],
  stories: [],
  blurbs: [],
  announcements: []
};

// Playback tracking
let playedMusic = new Set();
let playedJokes = new Set();
let playedStories = new Set();
let playedBlurbs = new Set();
let playedAnnouncements = new Set();

// DJ mode state
let songsInCurrentBlock = 0;
let lastAnnouncementTime = null;

// ========================================
// GITHUB API - FOLDER SCANNING
// ========================================
async function scanGitHubFolder(path, recursive = true) {
  const url = `https://api.github.com/repos/${CONFIG.github.owner}/${CONFIG.github.repo}/contents/${path}?ref=${CONFIG.github.branch}`;
  
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Folder not found: ${path}`);
      return [];
    }
    
    const items = await response.json();
    let files = [];
    
    for (const item of items) {
      if (item.type === 'file' && isAudioFile(item.name)) {
        files.push({
          name: item.name,
          url: item.download_url,
          path: item.path
        });
      } else if (item.type === 'dir' && recursive) {
        // Recursively scan subfolders
        const subFiles = await scanGitHubFolder(item.path, true);
        files = files.concat(subFiles);
      }
    }
    
    return files;
  } catch (error) {
    console.error(`Error scanning ${path}:`, error);
    return [];
  }
}

function isAudioFile(filename) {
  const extensions = ['.mp3', '.opus', '.m4a', '.wav', '.ogg', '.aac'];
  return extensions.some(ext => filename.toLowerCase().endsWith(ext));
}

// ========================================
// INITIALIZATION
// ========================================
async function initializePlayer() {
  showStatus('Loading audio library from GitHub...');
  
  try {
    // Scan all folders
    pools.music = await scanGitHubFolder(CONFIG.folders.music);
    pools.intros = await scanGitHubFolder(CONFIG.folders.intros);
    pools.outros = await scanGitHubFolder(CONFIG.folders.outros);
    pools.jokes = await scanGitHubFolder(CONFIG.folders.jokes);
    pools.stories = await scanGitHubFolder(CONFIG.folders.stories);
    pools.blurbs = await scanGitHubFolder(CONFIG.folders.blurbs);
    pools.announcements = await scanGitHubFolder(CONFIG.folders.announcements);
    
    // Build specific intro/outro mappings
    const specificIntros = await scanGitHubFolder(CONFIG.folders.specific_intros);
    const specificOutros = await scanGitHubFolder(CONFIG.folders.specific_outros);
    
    pools.specific_intros = buildSpecificMapping(specificIntros, '-intro');
    pools.specific_outros = buildSpecificMapping(specificOutros, '-outro');
    
    console.log('📊 Audio Library Loaded:');
    console.log(`   Music: ${pools.music.length}`);
    console.log(`   Intros: ${pools.intros.length} (+ ${Object.keys(pools.specific_intros).length} specific)`);
    console.log(`   Outros: ${pools.outros.length} (+ ${Object.keys(pools.specific_outros).length} specific)`);
    console.log(`   Jokes: ${pools.jokes.length}`);
    console.log(`   Stories: ${pools.stories.length}`);
    console.log(`   Blurbs: ${pools.blurbs.length}`);
    console.log(`   Announcements: ${pools.announcements.length}`);
    
    if (pools.music.length === 0) {
      showStatus('❌ No music found! Upload some songs to audio/music folder.');
      return false;
    }
    
    showStatus('✅ Ready to play!');
    return true;
  } catch (error) {
    console.error('Failed to load audio library:', error);
    showStatus('❌ Failed to load audio library. Check console for details.');
    return false;
  }
}

function buildSpecificMapping(files, suffix) {
  const mapping = {};
  files.forEach(file => {
    // Extract song name from "SongName-intro.mp3" or "SongName-outro.mp3"
    const baseName = file.name.replace(suffix, '').replace(/\.[^/.]+$/, '');
    mapping[baseName] = file;
  });
  return mapping;
}

// ========================================
// PLAYLIST GENERATION (DJ MODE LOGIC)
// ========================================
function buildNextTracks() {
  const tracks = [];
  
  // Check if 15 minutes since last announcement
  const needsAnnouncement = shouldPlayAnnouncement();
  if (needsAnnouncement && pools.announcements.length > 0) {
    const announcement = pickUnplayed(pools.announcements, playedAnnouncements);
    if (announcement) {
      tracks.push({
        file: announcement,
        title: 'Announcement',
        type: 'announcement'
      });
      lastAnnouncementTime = Date.now();
      return tracks;
    }
  }
  
  // After 2 songs, consider playing content
  if (songsInCurrentBlock >= 2) {
    songsInCurrentBlock = 0;
    
    // Roll dice based on percentages
    const roll = Math.random() * 100;
    let cumulative = 0;
    
    cumulative += CONFIG.settings.jokeChance;
    if (roll < cumulative && pools.jokes.length > 0) {
      const joke = pickUnplayed(pools.jokes, playedJokes);
      if (joke) {
        tracks.push({
          file: joke,
          title: "Burt's Joke",
          type: 'joke'
        });
        return tracks;
      }
    }
    
    cumulative += CONFIG.settings.storyChance;
    if (roll < cumulative && pools.stories.length > 0) {
      const story = pickUnplayed(pools.stories, playedStories);
      if (story) {
        tracks.push({
          file: story,
          title: "Burt's Story",
          type: 'story'
        });
        return tracks;
      }
    }
    
    cumulative += CONFIG.settings.blurbChance;
    if (roll < cumulative && pools.blurbs.length > 0) {
      const blurb = pickUnplayed(pools.blurbs, playedBlurbs);
      if (blurb) {
        tracks.push({
          file: blurb,
          title: "Burt's Commentary",
          type: 'blurb'
        });
        return tracks;
      }
    }
    
    // Else: falls into "nothing" percentage - just play music
  }
  
  // Play a song with intro/outro
  const song = pickUnplayed(pools.music, playedMusic);
  if (!song) {
    // All songs played - reset history
    playedMusic.clear();
    return buildNextTracks();
  }
  
  const isFirstInBlock = songsInCurrentBlock === 0;
  const isSecondInBlock = songsInCurrentBlock === 1;
  
  // INTRO (first song only)
  if (isFirstInBlock) {
    const intro = findIntroForSong(song);
    if (intro) {
      tracks.push({
        file: intro,
        title: 'Intro',
        type: 'intro'
      });
    }
  }
  
  // MAIN SONG
  tracks.push({
    file: song,
    title: song.name.replace(/\.[^/.]+$/, ''),  // Remove extension
    type: 'music'
  });
  
  // OUTRO (second song only)
  if (isSecondInBlock) {
    const outro = findOutroForSong(song);
    if (outro) {
      tracks.push({
        file: outro,
        title: 'Outro',
        type: 'outro'
      });
    }
  }
  
  songsInCurrentBlock++;
  return tracks;
}

function shouldPlayAnnouncement() {
  if (!lastAnnouncementTime) {
    lastAnnouncementTime = Date.now();
    return false;
  }
  
  const minutesSinceAnnouncement = (Date.now() - lastAnnouncementTime) / 1000 / 60;
  return minutesSinceAnnouncement >= CONFIG.settings.announcementIntervalMinutes;
}

function findIntroForSong(song) {
  const baseName = song.name.replace(/\.[^/.]+$/, '');
  
  // Try specific intro first
  if (pools.specific_intros[baseName]) {
    return pools.specific_intros[baseName];
  }
  
  // Fall back to generic intro
  if (pools.intros.length > 0) {
    return pickRandom(pools.intros);
  }
  
  return null;
}

function findOutroForSong(song) {
  const baseName = song.name.replace(/\.[^/.]+$/, '');
  
  // Try specific outro first
  if (pools.specific_outros[baseName]) {
    return pools.specific_outros[baseName];
  }
  
  // Fall back to generic outro
  if (pools.outros.length > 0) {
    return pickRandom(pools.outros);
  }
  
  return null;
}

// ========================================
// HELPER FUNCTIONS
// ========================================
function pickUnplayed(pool, playedSet) {
  const unplayed = pool.filter(item => !playedSet.has(item.url));
  
  if (unplayed.length === 0) {
    // All played - reset history for this pool
    playedSet.clear();
    return pickRandom(pool);
  }
  
  const picked = pickRandom(unplayed);
  if (picked) playedSet.add(picked.url);
  return picked;
}

function pickRandom(array) {
  if (array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

// ========================================
// PLAYBACK CONTROL
// ========================================
async function startPlaying() {
  const initialized = await initializePlayer();
  if (!initialized) return;
  
  // Hide start screen, show player
  document.getElementById('start-screen').style.display = 'none';
  document.getElementById('player-screen').style.display = 'block';
  
  // Build initial playlist
  playlist = buildNextTracks();
  currentTrackIndex = 0;
  
  // Start playing
  playCurrentTrack();
}

function playCurrentTrack() {
  if (playlist.length === 0 || currentTrackIndex >= playlist.length) {
    // Build next set of tracks
    playlist = buildNextTracks();
    currentTrackIndex = 0;
  }
  
  const track = playlist[currentTrackIndex];
  
  // Update display
  document.getElementById('track-title').textContent = track.title;
  document.getElementById('track-artist').textContent = track.type.toUpperCase();
  
  // Load and play audio
  audioPlayer.src = track.file.url;
  audioPlayer.play();
  isPlaying = true;
  
  updatePlayPauseButton();
  
  console.log(`▶️ Playing: ${track.title} (${track.type})`);
}

function playNextTrack() {
  currentTrackIndex++;
  playCurrentTrack();
}

function skipTrack() {
  playNextTrack();
}

function togglePlayPause() {
  if (isPlaying) {
    audioPlayer.pause();
    isPlaying = false;
  } else {
    audioPlayer.play();
    isPlaying = true;
  }
  updatePlayPauseButton();
}

function updatePlayPauseButton() {
  const btn = document.getElementById('play-pause-btn');
  btn.textContent = isPlaying ? '⏸' : '▶';
}

function stopPlaying() {
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  isPlaying = false;
  
  // Return to start screen
  document.getElementById('player-screen').style.display = 'none';
  document.getElementById('start-screen').style.display = 'block';
}

function showStatus(message) {
  document.getElementById('loading-status').textContent = message;
}

// ========================================
// SETTINGS UI
// ========================================
function updateSettings() {
  CONFIG.settings.jokeChance = parseInt(document.getElementById('joke-slider').value);
  CONFIG.settings.storyChance = parseInt(document.getElementById('story-slider').value);
  CONFIG.settings.blurbChance = parseInt(document.getElementById('blurb-slider').value);
  
  // Auto-calculate "nothing" to make total 100%
  const total = CONFIG.settings.jokeChance + CONFIG.settings.storyChance + CONFIG.settings.blurbChance;
  CONFIG.settings.nothingChance = Math.max(0, 100 - total);
  
  // Update displays
  document.getElementById('joke-value').textContent = CONFIG.settings.jokeChance + '%';
  document.getElementById('story-value').textContent = CONFIG.settings.storyChance + '%';
  document.getElementById('blurb-value').textContent = CONFIG.settings.blurbChance + '%';
  document.getElementById('nothing-value').textContent = CONFIG.settings.nothingChance + '%';
  
  const isValid = total <= 100;
  document.getElementById('settings-warning').style.display = isValid ? 'none' : 'block';
}

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', () => {
  audioPlayer = document.getElementById('audio-player');
  
  // Button handlers
  document.getElementById('start-btn').addEventListener('click', startPlaying);
  document.getElementById('play-pause-btn').addEventListener('click', togglePlayPause);
  document.getElementById('skip-btn').addEventListener('click', skipTrack);
  document.getElementById('stop-btn').addEventListener('click', stopPlaying);
  document.getElementById('settings-btn').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.toggle('hidden');
  });
  
  // Volume control
  document.getElementById('volume').addEventListener('input', (e) => {
    audioPlayer.volume = e.target.value / 100;
  });
  
  // Settings sliders
  document.getElementById('joke-slider').addEventListener('input', updateSettings);
  document.getElementById('story-slider').addEventListener('input', updateSettings);
  document.getElementById('blurb-slider').addEventListener('input', updateSettings);
  
  // Auto-advance to next track
  audioPlayer.addEventListener('ended', playNextTrack);
  
  // Set initial volume
  audioPlayer.volume = 0.7;
  
  // Initialize settings display
  updateSettings();
  
  showStatus('Click START to begin');
});
