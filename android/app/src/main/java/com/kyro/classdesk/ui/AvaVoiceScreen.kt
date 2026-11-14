package com.kyro.classdesk.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import com.kyro.classdesk.data.ChatRequest
import com.kyro.classdesk.data.ClassDeskApi
import kotlinx.coroutines.launch
import java.util.Locale

@Composable
fun AvaVoiceScreen(api: ClassDeskApi) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var recognizer by remember { mutableStateOf<SpeechRecognizer?>(null) }
    var speech by remember { mutableStateOf<TextToSpeech?>(null) }
    var ttsReady by remember { mutableStateOf(false) }
    var sessionActive by remember { mutableStateOf(false) }
    var listening by remember { mutableStateOf(false) }
    var processing by remember { mutableStateOf(false) }
    var speaking by remember { mutableStateOf(false) }
    var userStopped by remember { mutableStateOf(false) }
    var transcript by remember { mutableStateOf("Your spoken instruction will appear here.") }
    var response by remember { mutableStateOf("Ava's response will appear here.") }
    var error by remember { mutableStateOf<String?>(null) }

    fun stopSession() {
        sessionActive = false
        userStopped = true
        recognizer?.cancel()
        speech?.stop()
        listening = false
        processing = false
        speaking = false
    }

    fun startRecognition() {
        val engine = recognizer
        if (engine == null) {
            error = "Speech recognition is unavailable on this device."
            return
        }
        sessionActive = true
        userStopped = false
        error = null
        listening = true
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-NG")
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, "en-NG")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        }
        try { engine.startListening(intent) }
        catch (_: Exception) {
            listening = false
            error = "Could not start speech recognition. Check device speech services."
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRecognition()
        else error = "Microphone permission was not granted. Ava has not started listening."
    }

    DisposableEffect(Unit) {
        if (SpeechRecognizer.isRecognitionAvailable(context)) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(context).also { engine ->
                engine.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) { listening = true }
                    override fun onBeginningOfSpeech() { listening = true }
                    override fun onRmsChanged(rmsdB: Float) {}
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() { listening = false; processing = true }
                    override fun onError(errorCode: Int) {
                        listening = false
                        processing = false
                        if (userStopped) { userStopped = false; return }
                        error = when (errorCode) {
                            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required."
                            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech service needs an internet connection."
                            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I didn't catch that. Tap the microphone and try again."
                            else -> "Speech recognition stopped. Tap to try again."
                        }
                    }
                    override fun onResults(results: Bundle?) {
                        val spoken = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                        listening = false
                        if (spoken.isBlank()) { processing = false; error = "No speech was recognised."; return }
                        transcript = spoken
                        processing = true
                        scope.launch {
                            try {
                                val result = api.chat(ChatRequest(message = spoken, voice = true))
                                val answer = result.body()?.answer
                                if (!sessionActive) return@launch
                                if (result.isSuccessful && !answer.isNullOrBlank()) {
                                    response = answer
                                    processing = false
                                    if (ttsReady) {
                                        speaking = true
                                        speech?.speak(answer, TextToSpeech.QUEUE_FLUSH, null, "classdesk-ava-response")
                                    } else error = "Ava replied, but text-to-speech is not ready on this device."
                                } else {
                                    processing = false
                                    error = result.body()?.error ?: "Ava could not complete that request."
                                }
                            } catch (_: Exception) {
                                if (!sessionActive) return@launch
                                processing = false
                                error = "Could not reach Ava. Check your connection."
                            }
                        }
                    }
                    override fun onPartialResults(partialResults: Bundle?) {}
                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
            }
        }
        val engine = TextToSpeech(context) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (status == TextToSpeech.SUCCESS) speech?.language = Locale.UK
        }
        speech = engine
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { speaking = true }
            override fun onDone(utteranceId: String?) {\n                speaking = false\n                // Continue the user-started voice session after Ava finishes speaking.\n                // stopSession() clears sessionActive, so this can never reopen the mic after End.\n                if (sessionActive) startRecognition()\n            }
            override fun onError(utteranceId: String?) { speaking = false; error = "Ava's speech output failed." }
        })
        onDispose {
            recognizer?.destroy()
            recognizer = null
            speech?.stop()
            speech?.shutdown()
            speech = null
        }
    }

    val transition = rememberInfiniteTransition(label = "ava-orb")
    val rotation by transition.animateFloat(
        initialValue = 0f, targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(9000, easing = FastOutSlowInEasing), RepeatMode.Restart),
        label = "orb-rotation"
    )
    val state = when {
        error != null -> "VOICE ERROR"
        speaking -> "SPEAKING"
        processing -> "PROCESSING"
        listening -> "LISTENING"
        else -> "STANDBY"
    }
    Column(
        Modifier.fillMaxWidth().padding(18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("AFIT CLASSDESK / VOICE INTERFACE", color = Color(0xFF42D9F5), fontSize = 10.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
        Box(Modifier.size(174.dp), contentAlignment = Alignment.Center) {
            Box(Modifier.size(164.dp).graphicsLayer { rotationZ = rotation }.background(
                Brush.sweepGradient(listOf(Color(0xFF42D9F5), Color(0xFF172C45), Color(0xFFF2C94C), Color(0xFF42D9F5)), center = androidx.compose.ui.geometry.Offset(82f, 82f)),
                CircleShape
            ))
            Box(Modifier.size(146.dp).background(Color(0xFF0B1420), CircleShape), contentAlignment = Alignment.Center) {
                Text("✳", color = Color(0xFF42D9F5), fontSize = 54.sp, fontWeight = FontWeight.Light)
            }
        }
        Text("AVA", color = Color.White, fontSize = 26.sp, fontWeight = FontWeight.Bold, letterSpacing = 3.sp)
        Text(state, color = if (error != null) Color(0xFFFF7D78) else Color(0xFFF2C94C), fontSize = 11.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
        Surface(color = Color(0xFF111B28), shape = RoundedCornerShape(6.dp), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("LATEST INPUT", color = Color(0xFF42D9F5), fontSize = 10.sp, letterSpacing = 1.5.sp)
                Text(transcript, color = Color.White, fontSize = 14.sp)
                HorizontalDivider(color = Color(0xFF26384B))
                Text("LATEST RESPONSE", color = Color(0xFFF2C94C), fontSize = 10.sp, letterSpacing = 1.5.sp)
                Text(response, color = Color(0xFFCFD9E4), fontSize = 14.sp)
            }
        }
        error?.let { Text(it, color = Color(0xFFFF7D78), fontSize = 12.sp) }
        Button(
            onClick = {
                if (listening || speaking) stopSession()
                else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startRecognition()
                else permission.launch(Manifest.permission.RECORD_AUDIO)
            },
            enabled = !processing,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF42D9F5), contentColor = Color(0xFF0A1019)),
            shape = RoundedCornerShape(6.dp)
        ) {
            Text(if (listening || speaking) "STOP MICROPHONE" else "ACTIVATE MICROPHONE", fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 7.dp))
        }
        OutlinedButton(onClick = { stopSession(); error = null }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(6.dp)) {
            Text("END VOICE SESSION", color = Color(0xFFF2C94C))
        }
        Text("MICROPHONE IS ONLY USED AFTER YOU TAP ACTIVATE. NO BACKGROUND LISTENING.", color = Color(0xFF91A4B8), fontSize = 9.sp, letterSpacing = 0.6.sp)
    }
}
