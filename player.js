// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
  github: {
    owner: 'leone337',
    repo: 'DJ-Burt-WebPlayerTest',
    branch: 'main'
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
    announcements_calendar: 'audio/announcements/calendar',  // NEW
    announcements_other: 'audio/announcements/other',        // NEW
    announcements_special: 'audio/announcements/special'     // NEW (lunch/dinner)
  },
  
  settings: {
    jokeChance: 15,
    storyChance: 15,
    blurbChance: 10,
    nothingChance: 60,
    announcementIntervalMinutes: 15,
    
    // NEW: Announcement scheduling
    calendarAnnouncementIntervalMinutes: 30,
    otherAnnouncementIntervalMinutes: 30,
    
    morningCutoff: "10:30",
    afternoonCutoff: "14:00",
    
    lunchWarningStart: "11:40",
    lunchWarningEnd: "12:00",
    lunchQuietEnd: "12:40",
    
    dinnerWarningStart: "16:40",
    dinnerWarningEnd: "17:00",
    dinnerQuietEnd: "17:40"
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

// Announcement tracking
let lastCalendarAnnouncementTime = null;
let lastOtherAnnouncementTime = null;
let lastAnnouncementType = null; // 'calendar' or 'other'

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
// TIME UTILITIES
// ========================================
function getCurrentTime() {
  const now = new Date();
  return {
    hours: now.getHours(),
    minutes: now.getMinutes(),
    day: now.getDay(), // 0 = Sunday, 1 = Monday, etc.
    dayName: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()]
  };
}

function parseTime(timeString) {
  // "10:30" -> { hours: 10, minutes: 30 }
  const [hours, minutes] = timeString.split(':').map(Number);
  return { hours, minutes };
}

function isTimeBetween(currentTime, startTime, endTime) {
  const current = currentTime.hours * 60 + currentTime.minutes;
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  const startMin = start.hours * 60 + start.minutes;
  const endMin = end.hours * 60 + end.minutes;
  
  return current >= startMin && current < endMin;
}

function isTimeAfter(currentTime, afterTime) {
  const current = currentTime.hours * 60 + currentTime.minutes;
  const after = parseTime(afterTime);
  const afterMin = after.hours * 60 + after.minutes;
  
  return current >= afterMin;
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
    
    // NEW: Load announcement folders
    pools.announcements_calendar = await scanGitHubFolder(CONFIG.folders.announcements_calendar);
    pools.announcements_other = await scanGitHubFolder(CONFIG.folders.announcements_other);
    pools.announcements_special = await scanGitHubFolder(CONFIG.folders.announcements_special);
    
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
    console.log(`   Calendar Announcements: ${pools.announcements_calendar.length}`);
    console.log(`   Other Announcements: ${pools.announcements_other.length}`);
    console.log(`   Special Announcements: ${pools.announcements_special.length}`);
    
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
  
  // Check if we're in meal quiet period
  const currentTime = getCurrentTime();
  if (isInMealQuietPeriod(currentTime)) {
    console.log('🍽️ Meal time - music only, no DJ content');
    // Just play music, skip all DJ content
    const song = pickUnplayed(pools.music, playedMusic);
    if (!song) {
      playedMusic.clear();
      return buildNextTracks();
    }
    
    tracks.push({
      file: song,
      title: song.name.replace(/\.[^/.]+$/, ''),
      type: 'music'
    });
    
    songsInCurrentBlock++;
    return tracks;
  }
  
  // Check for announcements
  const announcementNeeded = shouldPlayAnnouncement();
  if (announcementNeeded) {
    if (announcementNeeded.type === 'meal') {
      // Meal warning
      const mealFile = getMealAnnouncement(announcementNeeded.meal);
      if (mealFile) {
        tracks.push({
          file: mealFile,
          title: `${announcementNeeded.meal} soon`,
          type: 'announcement-meal'
        });
        lastAnnouncementTime = Date.now();
        return tracks;
      }
    } else if (announcementNeeded.type === 'calendar') {
      // Calendar announcement
      const calendarFiles = getCalendarAnnouncement();
      if (calendarFiles) {
        calendarFiles.forEach(file => {
          tracks.push({
            file: file,
            title: file.name.replace(/\.[^/.]+$/, ''),
            type: 'announcement-calendar'
          });
        });
        lastCalendarAnnouncementTime = Date.now();
        lastAnnouncementTime = Date.now();
        lastAnnouncementType = 'calendar';
        return tracks;
      }
    } else if (announcementNeeded.type === 'other') {
      // Other announcement
      const otherFile = pickRandom(pools.announcements_other);
      if (otherFile) {
        tracks.push({
          file: otherFile,
          title: otherFile.name.replace(/\.[^/.]+$/, ''),
          type: 'announcement-other'
        });
        lastOtherAnnouncementTime = Date.now();
        lastAnnouncementTime = Date.now();
        lastAnnouncementType = 'other';
        return tracks;
      }
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
    title: song.name.replace(/\.[^/.]+$/, ''),
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

// ========================================
// ANNOUNCEMENT SCHEDULING
// ========================================
function shouldPlayAnnouncement() {
  const currentTime = getCurrentTime();
  
  // Check if we're in meal quiet periods (NO announcements during these times)
  if (isInMealQuietPeriod(currentTime)) {
    console.log('🍽️ Meal quiet period - no announcements');
    return null;
  }
  
  // Check for meal warning announcements (11:40-12:00, 16:40-17:00)
  if (isTimeBetween(currentTime, CONFIG.settings.lunchWarningStart, CONFIG.settings.lunchWarningEnd)) {
    if (!lastAnnouncementTime || minutesSince(lastAnnouncementTime) >= CONFIG.settings.announcementIntervalMinutes) {
      console.log('🍽️ Lunch warning time');
      return { type: 'meal', meal: 'lunch' };
    }
  }
  
  if (isTimeBetween(currentTime, CONFIG.settings.dinnerWarningStart, CONFIG.settings.dinnerWarningEnd)) {
    if (!lastAnnouncementTime || minutesSince(lastAnnouncementTime) >= CONFIG.settings.announcementIntervalMinutes) {
      console.log('🍽️ Dinner warning time');
      return { type: 'meal', meal: 'dinner' };
    }
  }
  
  // Determine which type of announcement should play (calendar or other)
  // They alternate every 30 minutes
  const needsCalendar = !lastCalendarAnnouncementTime || 
                       minutesSince(lastCalendarAnnouncementTime) >= CONFIG.settings.calendarAnnouncementIntervalMinutes;
  
  const needsOther = !lastOtherAnnouncementTime || 
                    minutesSince(lastOtherAnnouncementTime) >= CONFIG.settings.otherAnnouncementIntervalMinutes;
  
  // If we played calendar last, try other next (and vice versa)
  if (lastAnnouncementType === 'calendar' && needsOther) {
    console.log('📢 Time for OTHER announcement');
    return { type: 'other' };
  } else if (lastAnnouncementType === 'other' && needsCalendar) {
    console.log('📅 Time for CALENDAR announcement');
    return { type: 'calendar' };
  } else if (needsCalendar && needsOther) {
    // Both ready - start with calendar
    console.log('📅 Time for CALENDAR announcement (first)');
    return { type: 'calendar' };
  }
  
  return null;
}

function isInMealQuietPeriod(currentTime) {
  // During lunch: 12:00-12:40
  if (isTimeBetween(currentTime, CONFIG.settings.lunchWarningEnd, CONFIG.settings.lunchQuietEnd)) {
    return true;
  }
  
  // During dinner: 17:00-17:40
  if (isTimeBetween(currentTime, CONFIG.settings.dinnerWarningEnd, CONFIG.settings.dinnerQuietEnd)) {
    return true;
  }
  
  return false;
}

function minutesSince(timestamp) {
  return (Date.now() - timestamp) / 1000 / 60;
}

function getCalendarAnnouncement() {
  const currentTime = getCurrentTime();
  const dayName = currentTime.dayName;
  
  // Before 10:30: Read both morning and afternoon
  // 10:30-14:00: Only afternoon
  // After 14:00: None
  
  const beforeMorningCutoff = !isTimeAfter(currentTime, CONFIG.settings.morningCutoff);
  const beforeAfternoonCutoff = !isTimeAfter(currentTime, CONFIG.settings.afternoonCutoff);
  
  if (!beforeAfternoonCutoff) {
    // After 14:00 - no calendar announcements
    console.log('⏰ After 14:00 - no calendar announcements');
    return null;
  }
  
  const tracks = [];
  
  // Try to find morning announcement
  if (beforeMorningCutoff) {
    const morningFile = pools.announcements_calendar.find(f => 
      f.name.toLowerCase().includes(`${dayName}-morning`)
    );
    if (morningFile) {
      tracks.push(morningFile);
      console.log(`📅 Found morning: ${morningFile.name}`);
    }
  }
  
  // Try to find afternoon announcement (always before 14:00)
  const afternoonFile = pools.announcements_calendar.find(f => 
    f.name.toLowerCase().includes(`${dayName}-afternoon`)
  );
  if (afternoonFile) {
    tracks.push(afternoonFile);
    console.log(`📅 Found afternoon: ${afternoonFile.name}`);
  }
  
  return tracks.length > 0 ? tracks : null;
}

function getMealAnnouncement(meal) {
  // Find "lunch-soon.mp3" or "dinner-soon.mp3"
  const mealFile = pools.announcements_special.find(f => 
    f.name.toLowerCase().includes(`${meal}-soon`)
  );
  
  if (mealFile) {
    console.log(`🍽️ Found ${meal} announcement: ${mealFile.name}`);
    return mealFile;
  }
  
  console.warn(`⚠️ No ${meal} announcement found`);
  return null;
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

  // Debug button handlers
document.getElementById('force-calendar-btn').addEventListener('click', () => {
  console.log('🔧 DEBUG: Forcing calendar announcement');
  lastCalendarAnnouncementTime = 0; // Reset timer
  lastAnnouncementType = 'other'; // Ensure calendar plays next
  playlist = buildNextTracks();
  currentTrackIndex = 0;
  playCurrentTrack();
});

document.getElementById('force-other-btn').addEventListener('click', () => {
  console.log('🔧 DEBUG: Forcing other announcement');
  lastOtherAnnouncementTime = 0;
  lastAnnouncementType = 'calendar'; // Ensure other plays next
  playlist = buildNextTracks();
  currentTrackIndex = 0;
  playCurrentTrack();
});

document.getElementById('force-lunch-btn').addEventListener('click', () => {
  console.log('🔧 DEBUG: Forcing lunch warning');
  // Temporarily override time check
  const lunchFile = getMealAnnouncement('lunch');
  if (lunchFile) {
    playlist = [{
      file: lunchFile,
      title: 'Lunch soon',
      type: 'announcement-meal'
    }];
    currentTrackIndex = 0;
    playCurrentTrack();
  } else {
    alert('No lunch-soon.mp3 file found!');
  }
});

document.getElementById('force-dinner-btn').addEventListener('click', () => {
  console.log('🔧 DEBUG: Forcing dinner warning');
  const dinnerFile = getMealAnnouncement('dinner');
  if (dinnerFile) {
    playlist = [{
      file: dinnerFile,
      title: 'Dinner soon',
      type: 'announcement-meal'
    }];
    currentTrackIndex = 0;
    playCurrentTrack();
  } else {
    alert('No dinner-soon.mp3 file found!');
  }
});

document.getElementById('reset-timers-btn').addEventListener('click', () => {
  console.log('🔧 DEBUG: Resetting all timers');
  lastCalendarAnnouncementTime = null;
  lastOtherAnnouncementTime = null;
  lastAnnouncementTime = null;
  lastAnnouncementType = null;
  updateDebugInfo();
  alert('All announcement timers reset!');
});

// Test interval slider
document.getElementById('test-interval-slider').addEventListener('input', (e) => {
  const minutes = parseInt(e.target.value);
  CONFIG.settings.calendarAnnouncementIntervalMinutes = minutes;
  CONFIG.settings.otherAnnouncementIntervalMinutes = minutes;
  CONFIG.settings.announcementIntervalMinutes = minutes;
  document.getElementById('test-interval-value').textContent = `${minutes}min`;
  console.log(`🔧 DEBUG: Interval set to ${minutes} minutes`);
});

// Update debug info display every second
setInterval(updateDebugInfo, 1000);

function updateDebugInfo() {
  const now = new Date();
  document.getElementById('debug-current-time').textContent = 
    now.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  
  document.getElementById('debug-last-calendar').textContent = 
    lastCalendarAnnouncementTime ? formatTimeSince(lastCalendarAnnouncementTime) : 'Never';
  
  document.getElementById('debug-last-other').textContent = 
    lastOtherAnnouncementTime ? formatTimeSince(lastOtherAnnouncementTime) : 'Never';
  
  document.getElementById('debug-last-type').textContent = 
    lastAnnouncementType || 'None';
}

function formatTimeSince(timestamp) {
  const minutes = Math.floor((Date.now() - timestamp) / 1000 / 60);
  if (minutes < 1) return 'Just now';
  if (minutes === 1) return '1 min ago';
  return `${minutes} mins ago`;
}
  
  // Auto-advance to next track
  audioPlayer.addEventListener('ended', playNextTrack);
  
  // Set initial volume
  audioPlayer.volume = 0.7;
  
  // Initialize settings display
  updateSettings();
  
  showStatus('Click START to begin');
});
