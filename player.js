// ========================================
// CONFIGURATION
// ========================================
const CONFIG = {
  r2: {
    baseUrl: 'https://pub-9370ce973f68453bb0059afbc2ec7c3e.r2.dev',
    manifestPath: 'manifest.json'
  },
  
  settings: {
    jokeChance: 15,
    storyChance: 15,
    blurbChance: 10,
    nothingChance: 60,
    announcementIntervalMinutes: 15,
    
    // Announcement scheduling
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

// Content pools (populated from manifest)
let pools = {
  music: [],
  intros: [],
  specific_intros: {},
  outros: [],
  specific_outros: {},
  jokes: [],
  stories: [],
  blurbs: [],
  announcements_calendar: [],
  announcements_other: [],
  announcements_special: [],
  weather_conditions: [],
  weather_temperature: [],
  weather_extremes: []
};

// Announcement tracking
let lastCalendarAnnouncementTime = null;
let lastOtherAnnouncementTime = null;
let lastAnnouncementType = null; // 'calendar' or 'other'
let lastWeatherAnnouncementTime = null;
let weatherPlayedToday = false; // Reset daily

// Playback tracking
let playedMusic = new Set();
let playedJokes = new Set();
let playedStories = new Set();
let playedBlurbs = new Set();
let playedAnnouncements = new Set();

// DJ mode state
let songsInCurrentBlock = 0;
let lastAnnouncementTime = null;

// Toggle controls
let morningEventsEnabled = true;
let afternoonEventsEnabled = true;
let instrumentalModeEnabled = false;

// Weather state
let cachedWeather = null;
let lastWeatherFetch = null;
const WEATHER_CACHE_MINUTES = 30; // Refresh weather every 30 minutes

// ========================================
// WEATHER API
// ========================================
async function fetchAdelaideWeather() {
  // Check cache first
  if (cachedWeather && lastWeatherFetch) {
    const minutesSinceLastFetch = (Date.now() - lastWeatherFetch) / 1000 / 60;
    if (minutesSinceLastFetch < WEATHER_CACHE_MINUTES) {
      console.log(`🌤️ Using cached weather (${Math.floor(minutesSinceLastFetch)}min old)`);
      return cachedWeather;
    }
  }
  
  try {
    // Adelaide coordinates: -34.9285°S, 138.6007°E
    // Open-Meteo API (free, no API key required)
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=-34.9285&longitude=138.6007&current=temperature_2m,weather_code&timezone=Australia%2FAdelaide';
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather API error: ${response.status}`);
    }
    
    const data = await response.json();
    const weather = {
      temperature: Math.round(data.current.temperature_2m),
      weatherCode: data.current.weather_code
    };
    
    // Cache the result
    cachedWeather = weather;
    lastWeatherFetch = Date.now();
    
    console.log(`🌤️ Weather fetched: ${weather.temperature}°C, code: ${weather.weatherCode}`);
    return weather;
    
  } catch (error) {
    console.error('Failed to fetch weather:', error);
    return null;
  }
}

function getWeatherConditionFile(weatherCode) {
  // WMO Weather interpretation codes
  // https://open-meteo.com/en/docs
  // 0: Clear sky
  // 1-3: Mainly clear, partly cloudy, overcast
  // 45-48: Fog
  // 51-67: Drizzle/rain
  // 71-77: Snow
  // 80-82: Rain showers
  // 85-86: Snow showers
  // 95-99: Thunderstorm
  
  let conditionName = 'sunny'; // default
  
  if (weatherCode === 0) {
    conditionName = 'sunny';
  } else if (weatherCode >= 1 && weatherCode <= 2) {
    conditionName = 'cloudy';
  } else if (weatherCode === 3) {
    conditionName = 'overcast';
  } else if (weatherCode >= 51 && weatherCode <= 57) {
    conditionName = 'rain';
  } else if (weatherCode >= 61 && weatherCode <= 67) {
    conditionName = 'rain';
  } else if (weatherCode >= 80 && weatherCode <= 82) {
    conditionName = 'showers';
  } else if (weatherCode >= 95 && weatherCode <= 99) {
    conditionName = 'storm';
  }
  
  // Find matching file
  const file = pools.weather_conditions.find(f => 
    f.name.toLowerCase().includes(conditionName)
  );
  
  if (file) {
    console.log(`🌤️ Found condition file: ${file.name}`);
    return file;
  }
  
  console.warn(`⚠️ No weather condition file found for: ${conditionName}`);
  return null;
}

function getWeatherTemperatureFile(temperature) {
  // Check for extreme temperatures first
  if (temperature <= 1) {
    const extremeFile = pools.weather_extremes.find(f => 
      f.name.toLowerCase().includes(`temp-${temperature}`)
    );
    if (extremeFile) {
      console.log(`🌡️ Found extreme temp file: ${extremeFile.name}`);
      return extremeFile;
    }
  }
  
  if (temperature >= 42) {
    const extremeFile = pools.weather_extremes.find(f => 
      f.name.toLowerCase().includes(`temp-${temperature}`)
    );
    if (extremeFile) {
      console.log(`🌡️ Found extreme temp file: ${extremeFile.name}`);
      return extremeFile;
    }
  }
  
  // Otherwise use temperature range files
  let tempRange = '';
  if (temperature < 5) tempRange = 'under-5';
  else if (temperature < 10) tempRange = '5-10';
  else if (temperature < 15) tempRange = '10-15';
  else if (temperature < 20) tempRange = '15-20';
  else if (temperature < 25) tempRange = '20-25';
  else if (temperature < 30) tempRange = '25-30';
  else if (temperature < 35) tempRange = '30-35';
  else if (temperature < 40) tempRange = '35-40';
  else tempRange = 'over-40';
  
  const file = pools.weather_temperature.find(f => 
    f.name.toLowerCase().includes(`temp-${tempRange}`)
  );
  
  if (file) {
    console.log(`🌡️ Found temp file: ${file.name} (${temperature}°C)`);
    return file;
  }
  
  console.warn(`⚠️ No weather temperature file found for: ${temperature}°C`);
  return null;
}

async function getWeatherAnnouncement() {
  // Check if we have weather files
  if (pools.weather_conditions.length === 0 && pools.weather_temperature.length === 0) {
    console.log('⚠️ No weather files available');
    return null;
  }
  
  const weather = await fetchAdelaideWeather();
  if (!weather) {
    return null;
  }
  
  const tracks = [];
  
  // Get condition file
  const conditionFile = getWeatherConditionFile(weather.weatherCode);
  if (conditionFile) {
    tracks.push(conditionFile);
  }
  
  // Get temperature file
  const tempFile = getWeatherTemperatureFile(weather.temperature);
  if (tempFile) {
    tracks.push(tempFile);
  }
  
  return tracks.length > 0 ? tracks : null;
}

// ========================================
// HELPER FUNCTIONS FOR MUSIC FILTERING
// ========================================
function getMusicPool() {
  if (!instrumentalModeEnabled) {
    return pools.music;
  }
  
  // Filter for instrumental tracks (contain "instrumental" or "inst" in filename)
  const instrumentalTracks = pools.music.filter(track => {
    const name = track.name.toLowerCase();
    return name.includes('instrumental') || name.includes('inst') || name.includes('(i)');
  });
  
  if (instrumentalTracks.length > 0) {
    console.log(`🎵 Instrumental mode: ${instrumentalTracks.length} tracks available`);
    return instrumentalTracks;
  }
  
  // Fallback to all music if no instrumental tracks found
  console.warn('⚠️ No instrumental tracks found, using all music');
  return pools.music;
}

// ========================================
// R2 MANIFEST LOADING
// ========================================
async function loadManifest() {
  const url = `${CONFIG.r2.baseUrl}/${CONFIG.r2.manifestPath}`;
  
  try {
    showStatus('Loading audio library from R2...');
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status}`);
    }
    
    const manifest = await response.json();
    return manifest;
  } catch (error) {
    console.error('Error loading manifest:', error);
    return null;
  }
}

function buildFileObject(filename, folder) {
  // Build the R2 URL for this file - encode filename to handle spaces and special chars
  let url;
  
  // Handle announcements subfolders
  if (folder === 'calendar' || folder === 'other' || folder === 'special') {
    url = `${CONFIG.r2.baseUrl}/announcements/${folder}/${encodeURIComponent(filename)}`;
  }
  // Handle weather subfolders
  else if (folder === 'weather-conditions') {
    url = `${CONFIG.r2.baseUrl}/announcements/weather/conditions/${encodeURIComponent(filename)}`;
  }
  else if (folder === 'weather-temperature') {
    url = `${CONFIG.r2.baseUrl}/announcements/weather/temperature/${encodeURIComponent(filename)}`;
  }
  else if (folder === 'weather-extremes') {
    url = `${CONFIG.r2.baseUrl}/announcements/weather/extremes/${encodeURIComponent(filename)}`;
  }
  // Handle specific-intros and specific-outros (with hyphens in folder name)
  else if (folder === 'specific-intros') {
    url = `${CONFIG.r2.baseUrl}/specific-intros/${encodeURIComponent(filename)}`;
  }
  else if (folder === 'specific-outros') {
    url = `${CONFIG.r2.baseUrl}/specific-outros/${encodeURIComponent(filename)}`;
  }
  // Normal folders
  else {
    // Music folder is capitalized in R2
    const folderName = folder === 'music' ? 'Music' : folder;
    url = `${CONFIG.r2.baseUrl}/${folderName}/${encodeURIComponent(filename)}`;
  }
  
  return {
    name: filename,
    url: url,
    path: `${folder}/${filename}`
  };
}

function buildSpecificMapping(files, suffix) {
  const mapping = {};
  files.forEach(file => {
    // Extract song name from "SongName-intro.opus" or "SongName-outro.opus"
    const baseName = file.name.replace(suffix, '').replace(/\.[^/.]+$/, '');
    mapping[baseName] = file;
  });
  return mapping;
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
  try {
    const manifest = await loadManifest();
    
    if (!manifest) {
      showStatus('❌ Failed to load manifest.json');
      return false;
    }
    
    // Convert manifest arrays into file objects with R2 URLs
    pools.music = manifest.music.map(f => buildFileObject(f, 'music'));
    pools.intros = manifest.intros.map(f => buildFileObject(f, 'intros'));
    pools.outros = manifest.outros.map(f => buildFileObject(f, 'outros'));
    pools.jokes = manifest.jokes.map(f => buildFileObject(f, 'jokes'));
    pools.stories = manifest.stories.map(f => buildFileObject(f, 'stories'));
    pools.blurbs = manifest.blurbs.map(f => buildFileObject(f, 'blurbs'));
    
    // Announcements
    pools.announcements_calendar = manifest.announcements.calendar.map(f => buildFileObject(f, 'calendar'));
    pools.announcements_other = manifest.announcements.other.map(f => buildFileObject(f, 'other'));
    pools.announcements_special = manifest.announcements.special.map(f => buildFileObject(f, 'special'));
    
    // Weather (optional - may not exist yet)
    if (manifest.weather) {
      pools.weather_conditions = (manifest.weather.conditions || []).map(f => buildFileObject(f, 'weather-conditions'));
      pools.weather_temperature = (manifest.weather.temperature || []).map(f => buildFileObject(f, 'weather-temperature'));
      pools.weather_extremes = (manifest.weather.extremes || []).map(f => buildFileObject(f, 'weather-extremes'));
    }
    
    // Build specific intro/outro mappings
    const specificIntros = manifest.specific_intros.map(f => buildFileObject(f, 'specific-intros'));
    const specificOutros = manifest.specific_outros.map(f => buildFileObject(f, 'specific-outros'));
    
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
    console.log(`   Weather: ${pools.weather_conditions.length} conditions, ${pools.weather_temperature.length} temps, ${pools.weather_extremes.length} extremes`);
    
    if (pools.music.length === 0) {
      showStatus('❌ No music found! Upload songs to R2 bucket.');
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

// ========================================
// PLAYLIST GENERATION (DJ MODE LOGIC)
// ========================================
async function buildNextTracks() {
  const tracks = [];
  
  // Check if we're in meal quiet period
  const currentTime = getCurrentTime();
  if (isInMealQuietPeriod(currentTime)) {
    console.log('🍽️ Meal time - music only, no DJ content');
    // Just play music, skip all DJ content
    const song = pickUnplayed(getMusicPool(), playedMusic);
    if (!song) {
      playedMusic.clear();
      return await buildNextTracks();
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
      if (calendarFiles && calendarFiles.length > 0) {
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
      } else {
        // No calendar announcements available - update timers anyway so we alternate to other next
        console.log('⚠️ No CALENDAR announcements available, skipping to music');
        lastCalendarAnnouncementTime = Date.now();
        lastAnnouncementTime = Date.now();
        lastAnnouncementType = 'calendar';
        // Fall through to play music instead
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
      } else {
        // No other announcements available - update timers anyway so we alternate to calendar next
        console.log('⚠️ No OTHER announcements available, skipping to music');
        lastOtherAnnouncementTime = Date.now();
        lastAnnouncementTime = Date.now();
        lastAnnouncementType = 'other';
        // Fall through to play music instead
      }
    } else if (announcementNeeded.type === 'weather') {
      // Weather announcement
      const weatherFiles = await getWeatherAnnouncement();
      if (weatherFiles && weatherFiles.length > 0) {
        weatherFiles.forEach(file => {
          tracks.push({
            file: file,
            title: file.name.replace(/\.[^/.]+$/, ''),
            type: 'announcement-weather'
          });
        });
        weatherPlayedToday = true;
        lastWeatherAnnouncementTime = Date.now();
        lastAnnouncementTime = Date.now();
        return tracks;
      } else {
        // No weather available - update flag anyway
        console.log('⚠️ No WEATHER announcements available, skipping to music');
        weatherPlayedToday = true;
        lastWeatherAnnouncementTime = Date.now();
        lastAnnouncementTime = Date.now();
        // Fall through to play music instead
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
  const song = pickUnplayed(getMusicPool(), playedMusic);
  if (!song) {
    // All songs played - reset history
    playedMusic.clear();
    return await buildNextTracks();
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
  
  // Check for weather announcement (once per day, between 9:00-23:00 for testing)
  const weatherTime = currentTime.hours >= 9 && currentTime.hours < 23;
  if (weatherTime && !weatherPlayedToday) {
    if (!lastAnnouncementTime || minutesSince(lastAnnouncementTime) >= CONFIG.settings.announcementIntervalMinutes) {
      // Only play weather if we have weather files
      if (pools.weather_conditions.length > 0 || pools.weather_temperature.length > 0) {
        console.log('🌤️ Time for WEATHER announcement');
        return { type: 'weather' };
      }
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
  
  // Try to find morning announcement (if enabled)
  if (beforeMorningCutoff && morningEventsEnabled) {
    const morningFile = pools.announcements_calendar.find(f => 
      f.name.toLowerCase().includes(`${dayName}-morning`)
    );
    if (morningFile) {
      tracks.push(morningFile);
      console.log(`📅 Found morning: ${morningFile.name}`);
    }
  } else if (beforeMorningCutoff && !morningEventsEnabled) {
    console.log('🚫 Morning events disabled');
  }
  
  // Try to find afternoon announcement (if enabled)
  if (afternoonEventsEnabled) {
    const afternoonFile = pools.announcements_calendar.find(f => 
      f.name.toLowerCase().includes(`${dayName}-afternoon`)
    );
    if (afternoonFile) {
      tracks.push(afternoonFile);
      console.log(`📅 Found afternoon: ${afternoonFile.name}`);
    }
  } else {
    console.log('🚫 Afternoon events disabled');
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
  playlist = await buildNextTracks();
  currentTrackIndex = 0;
  
  // Start playing
  playCurrentTrack();
}

async function playCurrentTrack() {
  if (playlist.length === 0 || currentTrackIndex >= playlist.length) {
    // Build next set of tracks
    playlist = await buildNextTracks();
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

  // Toggle button handlers (sync both start and player screens)
  function updateToggleButtons() {
    // Morning events
    const morningBtns = [
      document.getElementById('morning-events-toggle'),
      document.getElementById('morning-events-toggle-player')
    ];
    morningBtns.forEach(btn => {
      if (btn) {
        btn.textContent = morningEventsEnabled ? '✅ Morning Events ON' : '❌ Morning Events OFF';
        btn.classList.toggle('toggle-off', !morningEventsEnabled);
      }
    });

    // Afternoon events
    const afternoonBtns = [
      document.getElementById('afternoon-events-toggle'),
      document.getElementById('afternoon-events-toggle-player')
    ];
    afternoonBtns.forEach(btn => {
      if (btn) {
        btn.textContent = afternoonEventsEnabled ? '✅ Afternoon Events ON' : '❌ Afternoon Events OFF';
        btn.classList.toggle('toggle-off', !afternoonEventsEnabled);
      }
    });

    // Instrumental mode
    const instrumentalBtns = [
      document.getElementById('instrumental-toggle'),
      document.getElementById('instrumental-toggle-player')
    ];
    instrumentalBtns.forEach(btn => {
      if (btn) {
        btn.textContent = instrumentalModeEnabled ? '🎵 Instrumental Mode ON' : '🎵 Instrumental Mode OFF';
        btn.classList.toggle('toggle-on', instrumentalModeEnabled);
      }
    });
  }

  // Morning events toggles (both screens)
  document.getElementById('morning-events-toggle').addEventListener('click', () => {
    morningEventsEnabled = !morningEventsEnabled;
    updateToggleButtons();
    console.log(`Morning events: ${morningEventsEnabled ? 'ON' : 'OFF'}`);
  });
  document.getElementById('morning-events-toggle-player').addEventListener('click', () => {
    morningEventsEnabled = !morningEventsEnabled;
    updateToggleButtons();
    console.log(`Morning events: ${morningEventsEnabled ? 'ON' : 'OFF'}`);
  });

  // Afternoon events toggles (both screens)
  document.getElementById('afternoon-events-toggle').addEventListener('click', () => {
    afternoonEventsEnabled = !afternoonEventsEnabled;
    updateToggleButtons();
    console.log(`Afternoon events: ${afternoonEventsEnabled ? 'ON' : 'OFF'}`);
  });
  document.getElementById('afternoon-events-toggle-player').addEventListener('click', () => {
    afternoonEventsEnabled = !afternoonEventsEnabled;
    updateToggleButtons();
    console.log(`Afternoon events: ${afternoonEventsEnabled ? 'ON' : 'OFF'}`);
  });

  // Instrumental mode toggles (both screens)
  document.getElementById('instrumental-toggle').addEventListener('click', () => {
    instrumentalModeEnabled = !instrumentalModeEnabled;
    updateToggleButtons();
    playedMusic.clear(); // Force re-selection from new pool
    console.log(`Instrumental mode: ${instrumentalModeEnabled ? 'ON' : 'OFF'}`);
  });
  document.getElementById('instrumental-toggle-player').addEventListener('click', () => {
    instrumentalModeEnabled = !instrumentalModeEnabled;
    updateToggleButtons();
    playedMusic.clear(); // Force re-selection from new pool
    console.log(`Instrumental mode: ${instrumentalModeEnabled ? 'ON' : 'OFF'}`);
  });

  // Debug button handlers
  document.getElementById('force-calendar-btn').addEventListener('click', async () => {
    console.log('🔧 DEBUG: Forcing calendar announcement');
    lastCalendarAnnouncementTime = 0; // Reset timer
    lastAnnouncementType = 'other'; // Ensure calendar plays next
    playlist = await buildNextTracks();
    currentTrackIndex = 0;
    playCurrentTrack();
  });

  document.getElementById('force-other-btn').addEventListener('click', async () => {
    console.log('🔧 DEBUG: Forcing other announcement');
    lastOtherAnnouncementTime = 0;
    lastAnnouncementType = 'calendar'; // Ensure other plays next
    playlist = await buildNextTracks();
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
      alert('No lunch-soon.opus file found!');
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
      alert('No dinner-soon.opus file found!');
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
