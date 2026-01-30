// ========================================
// GLOBAL VARIABLES
// ========================================
let schedule = null;
let playlist = [];
let currentTrackIndex = 0;
let audioPlayer = null;
let isPlaying = false;

// ========================================
// INITIALIZATION
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    // Get references to HTML elements
    audioPlayer = document.getElementById('audio-player');
    const startBtn = document.getElementById('start-btn');
    const playPauseBtn = document.getElementById('play-pause-btn');
    const skipBtn = document.getElementById('skip-btn');
    const stopBtn = document.getElementById('stop-btn');
    const volumeSlider = document.getElementById('volume');
    
    // Load the schedule from JSON file
    schedule = await loadSchedule();
    
    // Set up button click handlers
    startBtn.addEventListener('click', startPlaying);
    playPauseBtn.addEventListener('click', togglePlayPause);
    skipBtn.addEventListener('click', skipTrack);
    stopBtn.addEventListener('click', stopPlaying);
    volumeSlider.addEventListener('input', (e) => {
        audioPlayer.volume = e.target.value / 100;
    });
    
    // Auto-advance to next track when current one ends
    audioPlayer.addEventListener('ended', playNextTrack);
    
    // Set initial volume
    audioPlayer.volume = 0.7;
});

// ========================================
// LOAD SCHEDULE
// ========================================
async function loadSchedule() {
    try {
        const response = await fetch('schedule.json');
        return await response.json();
    } catch (error) {
        console.error('Failed to load schedule:', error);
        alert('Could not load schedule. Please check connection.');
        return null;
    }
}

// ========================================
// TIME CHECKING FUNCTIONS
// ========================================
function getCurrentTime() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

function getCurrentDay() {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[new Date().getDay()];
}

function isLunchTime() {
    const { hours, minutes } = getCurrentTime();
    // Between 12:00pm and 12:30pm
    return (hours === 12 && minutes < 30);
}

function getAnnouncementType() {
    const { hours, minutes } = getCurrentTime();
    const day = getCurrentDay();
    const daySchedule = schedule.weekly_schedule[day];
    
    // 12:00 - 12:30: No announcements (lunch mode)
    if (hours === 12 && minutes < 30) {
        return null;
    }
    
    // 11:30 - 12:00: Lunch soon
    if (hours === 11 && minutes >= 30) {
        return 'lunch_soon';
    }
    
    // 10:30 - 11:30: Morning events (if any scheduled)
    if (hours === 10 && minutes >= 30 || hours === 11 && minutes < 30) {
        if (daySchedule.morning && daySchedule.morning.length > 0) {
            return 'morning_event';
        }
    }
    
    // 12:30 - 14:00: Afternoon events (if any scheduled)
    if (hours === 12 && minutes >= 30 || hours === 13 || hours === 14 && minutes === 0) {
        if (daySchedule.afternoon && daySchedule.afternoon.length > 0) {
            return 'afternoon_event';
        }
    }
    
    // Default: Management announcement
    return 'management';
}

// ========================================
// PLAYLIST BUILDING
// ========================================
function buildPlaylist() {
    const newPlaylist = [];
    
    // Check if it's lunch time - special mode
    if (isLunchTime()) {
        // Only ambient music during lunch
        schedule.ambient_lunch.forEach(track => {
            newPlaylist.push({
                file: track,
                title: 'Lunch Ambience',
                type: 'ambient'
            });
        });
        return newPlaylist;
    }
    
    // Normal rotation: intro → song → song → outro → announcement → dj → repeat
    
    // 1. Intro
    newPlaylist.push({
        file: schedule.intro,
        title: "Burt's Introduction",
        type: 'intro'
    });
    
    // 2 & 3. Two songs
    schedule.songs.forEach((song, index) => {
        newPlaylist.push({
            file: song,
            title: `Song ${index + 1}`,
            type: 'music'
        });
    });
    
    // 4. Outro
    newPlaylist.push({
        file: schedule.outro,
        title: "Burt's Outro",
        type: 'outro'
    });
    
    // 5. Announcement (based on time)
    const announcementType = getAnnouncementType();
    if (announcementType) {
        let announcementFile = null;
        const day = getCurrentDay();
        const daySchedule = schedule.weekly_schedule[day];
        
        if (announcementType === 'lunch_soon') {
            announcementFile = schedule.announcements.lunch_soon;
        } else if (announcementType === 'morning_event' && daySchedule.morning.length > 0) {
            announcementFile = daySchedule.morning[0]; // Use first morning event
        } else if (announcementType === 'afternoon_event' && daySchedule.afternoon.length > 0) {
            announcementFile = daySchedule.afternoon[0]; // Use first afternoon event
        } else {
            announcementFile = schedule.announcements.management;
        }
        
        if (announcementFile) {
            newPlaylist.push({
                file: announcementFile,
                title: 'Announcement',
                type: 'announcement'
            });
        }
    }
    
    // 6. Random DJ track from pool
    const randomDJ = schedule.dj_pool[Math.floor(Math.random() * schedule.dj_pool.length)];
    newPlaylist.push({
        file: randomDJ,
        title: "Burt's Commentary",
        type: 'dj'
    });
    
    return newPlaylist;
}

// ========================================
// PLAYBACK CONTROL
// ========================================
function startPlaying() {
    // Hide start screen, show player
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('player-screen').style.display = 'block';
    
    // Build initial playlist
    playlist = buildPlaylist();
    currentTrackIndex = 0;
    
    // Start playing
    playCurrentTrack();
}

function playCurrentTrack() {
    if (playlist.length === 0) return;
    
    const track = playlist[currentTrackIndex];
    
    // Update display
    document.getElementById('track-title').textContent = track.title;
    document.getElementById('track-artist').textContent = track.type.toUpperCase();
    
    // Load and play audio
    audioPlayer.src = track.file;
    audioPlayer.play();
    isPlaying = true;
    
    updatePlayPauseButton();
}

function playNextTrack() {
    currentTrackIndex++;
    
    // If we've finished the playlist, rebuild it (handles time changes)
    if (currentTrackIndex >= playlist.length) {
        playlist = buildPlaylist();
        currentTrackIndex = 0;
    }
    
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
