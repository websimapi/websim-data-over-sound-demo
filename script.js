// --- DOM Elements ---
const messageInput = document.getElementById('message-input');
const transmitBtn = document.getElementById('transmit-btn');
const statusDisplay = document.getElementById('status');
const canvas = document.getElementById('visualizer');
const canvasContainer = document.getElementById('visualizer-container');
const ctx = canvas.getContext('2d');

// --- Web Audio & Transmission ---
let audioCtx;
const TONE_DURATION = 0.08; // seconds
const TONE_GAP = 0.04;      // seconds
const BASE_FREQ = 440;      // A4 note
const FREQ_STEP = 25;       // Hz per char code

let transmission = {
    isPlaying: false,
    data: [], // {char, frequency, startTime, endTime}
};

// --- Initialization ---
function init() {
    resizeCanvas();
    drawVisualizer();
    window.addEventListener('resize', () => {
        resizeCanvas();
        // redraw static elements if not playing
        if (!transmission.isPlaying) {
            drawVisualizer();
        }
    });

    const initAudio = async () => {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                await audioCtx.resume();
                statusDisplay.textContent = 'Status: Ready';
            } catch (e) {
                statusDisplay.textContent = 'Error: Web Audio not supported';
                alert('Web Audio API is not supported in this browser.');
            }
        }
    };

    document.body.addEventListener('click', initAudio, { once: true });
    document.body.addEventListener('touchend', initAudio, { once: true });

    transmitBtn.addEventListener('click', handleTransmit);
}

function handleTransmit() {
    const message = messageInput.value;
    if (!audioCtx) {
        statusDisplay.textContent = "Tap screen to enable audio first!";
        statusDisplay.style.color = "#ff5555";
        setTimeout(() => {
            statusDisplay.style.color = "var(--text-color)";
             if(!audioCtx) statusDisplay.textContent = 'Status: Tap screen to start';
        }, 2000);
        return;
    }
    if (message && !transmitBtn.disabled) {
        transmitMessage(message);
    }
}

// --- Audio Generation ---
function playTone(frequency, startTime, duration) {
    if (!audioCtx) return;

    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    const attackTime = 0.01;
    const releaseTime = 0.01;
    const peakGain = 0.3; // Lower volume to avoid clipping
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(peakGain, startTime + attackTime);
    gainNode.gain.setValueAtTime(peakGain, startTime + duration - releaseTime);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
}

// --- Main Transmission Logic ---
async function transmitMessage(message) {
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }

    transmitBtn.disabled = true;
    statusDisplay.textContent = 'Transmitting...';
    messageInput.disabled = true;

    transmission.isPlaying = true;
    const startTime = audioCtx.currentTime;
    transmission.data = [];
    let scheduledTime = startTime;

    const chars = message.split('');
    for (const char of chars) {
        const charCode = char.charCodeAt(0);
        // Map charCode to a reproducible frequency within an audible range
        const frequency = BASE_FREQ + ((charCode - 32) % 96) * FREQ_STEP;

        playTone(frequency, scheduledTime, TONE_DURATION);

        transmission.data.push({
            char,
            frequency,
            startTime: scheduledTime,
            endTime: scheduledTime + TONE_DURATION,
        });
        scheduledTime += TONE_DURATION + TONE_GAP;
    }

    const totalDuration = scheduledTime - startTime;
    setTimeout(() => {
        transmission.isPlaying = false;
        transmitBtn.disabled = false;
        messageInput.disabled = false;
        statusDisplay.textContent = 'Status: Transmission Complete';
        setTimeout(() => {
          if(!transmission.isPlaying) statusDisplay.textContent = 'Status: Ready';
        }, 2000);
    }, totalDuration * 1000 + 100);
}

// --- Visualization ---
function resizeCanvas() {
    canvas.width = canvasContainer.clientWidth * window.devicePixelRatio;
    canvas.height = canvasContainer.clientHeight * window.devicePixelRatio;
    canvas.style.width = `${canvasContainer.clientWidth}px`;
    canvas.style.height = `${canvasContainer.clientHeight}px`;
}

function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (!transmission.isPlaying && transmission.data.length === 0) {
        ctx.fillStyle = 'rgba(0, 255, 65, 0.5)';
        ctx.font = `${14 * window.devicePixelRatio}px Roboto Mono`;
        ctx.textAlign = 'center';
        ctx.fillText('Awaiting Transmission', canvas.width / 2, canvas.height / 2);
        return;
    }

    const currentTime = audioCtx ? audioCtx.currentTime : 0;
    const barWidth = canvas.width / (transmission.data.length || 1);
    const maxFreqRange = (95 * FREQ_STEP);

    for (let i = 0; i < transmission.data.length; i++) {
        const d = transmission.data[i];
        
        const y = canvas.height - ((d.frequency - BASE_FREQ) / maxFreqRange) * canvas.height * 0.9 - (canvas.height * 0.05);
        const barHeight = 2 * window.devicePixelRatio;
        
        const isCurrentlyPlaying = transmission.isPlaying && currentTime >= d.startTime && currentTime < d.endTime;

        if (isCurrentlyPlaying) {
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 10 * window.devicePixelRatio;
            ctx.shadowColor = '#ffffff';
            ctx.fillRect(i * barWidth, y - (barHeight * 1.5), Math.max(1, barWidth - 1), barHeight * 3);
            ctx.shadowBlur = 0;
            
            ctx.fillStyle = '#ffffff';
            ctx.font = `${12 * window.devicePixelRatio}px Roboto Mono`;
            ctx.textAlign = 'center';
            const charLabelY = canvas.height - (10 * window.devicePixelRatio);
            ctx.fillText(d.char, i * barWidth + barWidth / 2, charLabelY);
        } else {
            ctx.fillStyle = 'var(--primary-color)';
            ctx.fillRect(i * barWidth, y - barHeight/2, Math.max(1, barWidth - 1), barHeight);
        }
    }
}

// --- Start ---
init();

