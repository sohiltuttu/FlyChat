async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // Browser compatible mimeType detect ചെയ്യുന്നു
        let options = {};
        if (MediaRecorder.isTypeSupported('audio/webm')) {
            options = { mimeType: 'audio/webm' };
        } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
            options = { mimeType: 'audio/mp4' };
        }

        mediaRecorder = new MediaRecorder(stream, options);
        audioChunks = [];
        isCancelled = false;

        mediaRecorder.ondataavailable = event => {
            if (event.data.size > 0) audioChunks.push(event.data);
        };

        mediaRecorder.onstop = () => {
            clearInterval(timerInterval);
            stream.getTracks().forEach(track => track.stop());

            if (!isCancelled && audioChunks.length > 0) {
                const mimeType = mediaRecorder.mimeType || 'audio/webm';
                const audioBlob = new Blob(audioChunks, { type: mimeType });
                const reader = new FileReader();
                reader.onload = function(e) {
                    socket.emit('send-message', { room: currentRoom, message: e.target.result, type: 'audio' });
                };
                reader.readAsDataURL(audioBlob);
            }
            resetRecordingUI();
        };

        mediaRecorder.start();
        secondsElapsed = 0;
        updateTimerDisplay();
        timerInterval = setInterval(() => {
            secondsElapsed++;
            updateTimerDisplay();
        }, 1000);

        document.getElementById('text-controls').style.display = 'none';
        document.getElementById('recording-controls').style.display = 'flex';
    } catch (err) {
        alert('Microphone access denied or not available.');
    }
}
