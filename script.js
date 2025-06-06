// --- DOM Elements ---
const messageInput = document.getElementById('message-input');
const transmitBtn = document.getElementById('transmit-btn');
const statusDisplay = document.getElementById('status');
const canvas = document.getElementById('visualizer');
const canvasContainer = document.getElementById('visualizer-container');
const ctx = canvas.getContext('2d');
const senderBtn = document.getElementById('sender-btn');
const receiverBtn = document.getElementById('receiver-btn');
const senderView = document.getElementById('sender-view');
const receiverView = document.getElementById('receiver-view');
const receivedMessageDisplay = document.getElementById('received-message');
const clearBtn = document.getElementById('clear-btn');

// --- State ---
let currentMode = 'sender';

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

// --- Receiver State ---
let receiverState = {
    isListening: false,
    analyser: null,
    micStream: null,
    dataArray: null,
    lastChar: null,
    lastCharTime: 0,
    receivedMessage: "",
    silenceTimeout: null,
};


// --- Initialization ---
function init() {
    resizeCanvas();
    window.addEventListener('resize', () => {
        resizeCanvas();
    });

    const initAudio = async () => {
        if (!audioCtx) {
            try {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                await audioCtx.resume();
                if (currentMode === 'receiver') {
                    startListening();
                } else {
                    statusDisplay.textContent = 'Status: Ready';
                }
            } catch (e) {
                statusDisplay.textContent = 'Error: Web Audio not supported';
                alert('Web Audio API is not supported in this browser.');
            }
        }
    };

    document.body.addEventListener('click', initAudio, { once: true });
    document.body.addEventListener('touchend', initAudio, { once: true });

    transmitBtn.addEventListener('click', handleTransmit);
    senderBtn.addEventListener('click', () => setMode('sender'));
    receiverBtn.addEventListener('click', () => setMode('receiver'));
    clearBtn.addEventListener('click', () => {
        receiverState.receivedMessage = "";
        receivedMessageDisplay.textContent = "";
        if (currentMode === 'receiver' && receiverState.isListening) {
           statusDisplay.textContent = 'Status: Cleared. Listening...';
        }
    });

    requestAnimationFrame(drawVisualizer); // Start main loop
}

function setMode(newMode) {
    if (newMode === currentMode || transmission.isPlaying) return;

    currentMode = newMode;

    if (currentMode === 'sender') {
        senderView.classList.remove('hidden');
        receiverView.classList.add('hidden');
        senderBtn.classList.add('active');
        receiverBtn.classList.remove('active');
        
        stopListening();
        statusDisplay.textContent = 'Status: Ready';
        transmission.data = []; // Clear old transmission data for visualizer

    } else { // receiver
        receiverView.classList.remove('hidden');
        senderView.classList.add('hidden');
        receiverBtn.classList.add('active');
        senderBtn.classList.remove('active');

        startListening();
    }
}

function handleTransmit() {
    const message = messageInput.value;
    if (!audioCtx) {
        statusDisplay.textContent = "Tap screen to enable audio first!";
        statusDisplay.style.color = "#ff5555";
        setTimeout(() => {
            statusDisplay.style.color = "var(--text-color)";
             if(!audioCtx) statusDisplay.textContent = 'Status: Tap screen to start';
             else if (currentMode === 'sender') statusDisplay.textContent = 'Status: Ready';
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
    senderBtn.disabled = true;
    receiverBtn.disabled = true;
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
        senderBtn.disabled = false;
        receiverBtn.disabled = false;
        messageInput.disabled = false;
        statusDisplay.textContent = 'Status: Transmission Complete';
        setTimeout(() => {
          if(!transmission.isPlaying) statusDisplay.textContent = 'Status: Ready';
        }, 2000);
    }, totalDuration * 1000 + 100);
}

// --- Receiver Logic ---
async function startListening() {
    if (!audioCtx) {
        statusDisplay.textContent = 'Status: Tap screen to enable audio first';
        return;
    }
    if (receiverState.isListening) return;

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
            } 
        });
        receiverState.micStream = stream;

        const source = audioCtx.createMediaStreamSource(stream);
        receiverState.analyser = audioCtx.createAnalyser();
        receiverState.analyser.fftSize = 4096; // Higher resolution for better frequency detection
        
        source.connect(receiverState.analyser);
        // Do NOT connect to destination to avoid feedback loop

        receiverState.dataArray = new Uint8Array(receiverState.analyser.frequencyBinCount);
        receiverState.isListening = true;
        statusDisplay.textContent = 'Status: Listening...';

    } catch (err) {
        console.error('Error accessing microphone:', err);
        statusDisplay.textContent = 'Error: Mic access denied.';
        setMode('sender'); // Switch back to sender mode on error
    }
}

function stopListening() {
    if (receiverState.micStream) {
        receiverState.micStream.getTracks().forEach(track => track.stop());
    }
    if (receiverState.silenceTimeout) {
        clearTimeout(receiverState.silenceTimeout);
    }
    receiverState.isListening = false;
    receiverState.micStream = null;
    receiverState.analyser = null;
    receiverState.lastChar = null;
}

function processReceivedAudio() {
    if (!receiverState.isListening || !receiverState.analyser) return;

    receiverState.analyser.getByteFrequencyData(receiverState.dataArray);
    
    let maxVal = -1;
    let maxIndex = -1;
    const noiseThreshold = 120; // 0-255 scale. Adjust if needed.

    // Find the loudest frequency bin
    for (let i = 0; i < receiverState.analyser.frequencyBinCount; i++) {
        if (receiverState.dataArray[i] > maxVal) {
            maxVal = receiverState.dataArray[i];
            maxIndex = i;
        }
    }
    
    if (maxVal > noiseThreshold) {
        const freq = maxIndex * audioCtx.sampleRate / receiverState.analyser.fftSize;

        // Check if the detected frequency is within our transmission range
        if (freq >= BASE_FREQ && freq < BASE_FREQ + 96 * FREQ_STEP) {
            const charCode = Math.round((freq - BASE_FREQ) / FREQ_STEP) + 32;
            
            if (charCode >= 32 && charCode <= 126) { // Only printable ASCII
                const char = String.fromCharCode(charCode);
                const now = audioCtx.currentTime;
                
                // Debounce: add char only if it's new and enough time has passed
                if (char !== receiverState.lastChar && (now - receiverState.lastCharTime > (TONE_DURATION + TONE_GAP) * 0.75)) {
                    receiverState.receivedMessage += char;
                    receivedMessageDisplay.textContent = receiverState.receivedMessage;
                    receiverState.lastChar = char;
                    receiverState.lastCharTime = now;
                    statusDisplay.textContent = 'Status: Receiving...';
                }
            }

            clearTimeout(receiverState.silenceTimeout);
            receiverState.silenceTimeout = setTimeout(onSilence, 1500); // 1.5s silence = end of message
        }
    }
}

function onSilence() {
    if (receiverState.receivedMessage.length > 0) {
        statusDisplay.textContent = `Status: Message received!`;
    } else {
        if(currentMode === 'receiver') {
             statusDisplay.textContent = 'Status: Listening...';
        }
    }
    receiverState.lastChar = null; // Ready for a new transmission
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
    
    if (currentMode === 'sender') {
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
    } else { // Receiver Mode
        processReceivedAudio(); // Decode audio on each frame

        if (receiverState.isListening && receiverState.analyser) {
            const bufferLength = receiverState.analyser.frequencyBinCount;
            const barWidth = (canvas.width / bufferLength) * 2.5; // Make bars wider
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (receiverState.dataArray[i] / 255.0) * canvas.height;
                
                const hue = 120; // Green
                const saturation = 100;
                const lightness = Math.min(100, (receiverState.dataArray[i] / 255.0) * 100 + 20);

                ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
                ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
                x += barWidth;
            }
        } else {
             ctx.fillStyle = 'rgba(0, 255, 65, 0.5)';
             ctx.font = `${14 * window.devicePixelRatio}px Roboto Mono`;
             ctx.textAlign = 'center';
             if (!audioCtx) {
                 ctx.fillText('Tap screen to start', canvas.width / 2, canvas.height / 2);
             } else {
                 ctx.fillText('Waiting for Microphone...', canvas.width / 2, canvas.height / 2);
             }
        }
    }
}

// --- Start ---
init();