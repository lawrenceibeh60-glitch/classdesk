package com.kyro.classdesk.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import android.media.MediaPlayer
import java.io.File
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
import com.kyro.classdesk.data.AvaActionConfirmationDto
import com.kyro.classdesk.data.ChatHistoryItem
import com.kyro.classdesk.data.ClassDeskApi
import kotlinx.coroutines.launch
import java.util.Locale
import java.util.UUID

private data class AvaRecognitionLanguageProfile(
    val label: String,
    val locales: List<String?>
)

private val avaRecognitionLanguageProfiles = listOf(
    AvaRecognitionLanguageProfile("English (Nigeria)", listOf("en-NG", "en-GB", "en-US", "en", null)),
    AvaRecognitionLanguageProfile("Hausa", listOf("ha-NG", "ha", null)),
    AvaRecognitionLanguageProfile("Yoruba", listOf("yo-NG", "yo", null)),
    AvaRecognitionLanguageProfile("Igbo", listOf("ig-NG", "ig", null))
)

private fun buildAvaRecognitionIntent(languageTag: String?): Intent =
    Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        if (!languageTag.isNullOrBlank()) {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, languageTag)
        }
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
    }

@Composable
fun AvaVoiceScreen(api: ClassDeskApi) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var recognizer by remember { mutableStateOf<SpeechRecognizer?>(null) }
    var speech by remember { mutableStateOf<TextToSpeech?>(null) }
    var audioPlayer by remember { mutableStateOf<MediaPlayer?>(null) }
    var audioFile by remember { mutableStateOf<File?>(null) }
    var ttsReady by remember { mutableStateOf(false) }
    var sessionActive by remember { mutableStateOf(false) }
    var listening by remember { mutableStateOf(false) }
    var processing by remember { mutableStateOf(false) }
    var speaking by remember { mutableStateOf(false) }
    var userStopped by remember { mutableStateOf(false) }
    var transcript by remember { mutableStateOf("Your spoken instruction will appear here.") }
    var response by remember { mutableStateOf("Ava's response will appear here.") }
    var conversationHistory by remember { mutableStateOf<List<ChatHistoryItem>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<AvaActionConfirmationDto?>(null) }
    var selectedLanguageIndex by remember { mutableIntStateOf(0) }
    var languageFallbackIndex by remember { mutableIntStateOf(0) }
    var languageMenuExpanded by remember { mutableStateOf(false) }
    var usingPlatformFallback by remember { mutableStateOf(false) }

    fun stopSession() {
        sessionActive = false
        userStopped = true
        recognizer?.cancel()
        speech?.stop()
        runCatching { audioPlayer?.stop() }
        runCatching { audioPlayer?.release() }
        audioPlayer = null
        audioFile?.let { runCatching { it.delete() } }
        audioFile = null
        listening = false
        processing = false
        speaking = false
    }

    fun speakOnDevice(text: String) {
        if (ttsReady) {
            speaking = true
            speech?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "classdesk-ava-fallback")
        } else {
            speaking = false
            error = "Ava voice service is unavailable and device speech output is not ready."
        }
    }
    fun startRecognition() {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            sessionActive = false
            listening = false
            error = "Microphone permission is required. Tap Activate to grant access before Ava listens."
            return
        }
        val engine = recognizer
        if (engine == null) {
            error = "Speech recognition is unavailable on this device."
            return
        }
        sessionActive = true
        userStopped = false
        error = null
        listening = true
        languageFallbackIndex = 0
        val initialLocale = avaRecognitionLanguageProfiles[selectedLanguageIndex].locales.firstOrNull()
        try {
            engine.startListening(buildAvaRecognitionIntent(initialLocale))
        } catch (_: Exception) {
            sessionActive = false
            listening = false
            processing = false
            error = "Android speech recognition could not start. Check the device's speech services, then tap Activate to retry."
        }
    }

    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startRecognition()
        else error = "Microphone permission was not granted. Ava has not started listening."
    }

    DisposableEffect(Unit) {
        if (SpeechRecognizer.isRecognitionAvailable(context)) {
            // Prefer Android's on-device engine when the OS and installed language pack support it.
            // Fall back to the platform recognition service on older or unsupported devices.
            val onDeviceAvailable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                SpeechRecognizer.isOnDeviceRecognitionAvailable(context)
            val speechEngine = if (onDeviceAvailable) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            else SpeechRecognizer.createSpeechRecognizer(context)
            usingPlatformFallback = !onDeviceAvailable
            recognizer = speechEngine
            speechEngine.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) { listening = true }
                    override fun onBeginningOfSpeech() { listening = true }
                    override fun onRmsChanged(rmsdB: Float) {}
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() { listening = false; processing = true }
                    override fun onError(errorCode: Int) {
                        listening = false
                        processing = false
                        if (userStopped) { userStopped = false; return }
                        if (errorCode == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED) {
                            val profile = avaRecognitionLanguageProfiles[selectedLanguageIndex]
                            val nextIndex = languageFallbackIndex + 1
                            if (nextIndex < profile.locales.size) {
                                languageFallbackIndex = nextIndex
                                val nextLocale = profile.locales[nextIndex]
                                val localeLabel = nextLocale ?: "Android's device default"
                                error = "This speech service does not support the previous language. Trying " + localeLabel + "…"
                                listening = true
                                processing = false
                                runCatching { recognizer?.startListening(buildAvaRecognitionIntent(nextLocale)) }
                                    .onFailure {
                                        listening = false
                                        sessionActive = false
                                        error = "Could not start the next language fallback. Check Android speech services and try again."
                                    }
                                return
                            }
                            if (!usingPlatformFallback) {
                                val platformEngine = runCatching { SpeechRecognizer.createSpeechRecognizer(context) }.getOrNull()
                                if (platformEngine != null) {
                                    platformEngine.setRecognitionListener(this)
                                    val previousEngine = recognizer
                                    recognizer = platformEngine
                                    usingPlatformFallback = true
                                    languageFallbackIndex = 0
                                    val firstLocale = profile.locales.firstOrNull()
                                    error = "On-device recognition does not support this language. Trying Android's platform speech service…"
                                    listening = true
                                    processing = false
                                    runCatching {
                                        previousEngine?.destroy()
                                        platformEngine.startListening(buildAvaRecognitionIntent(firstLocale))
                                    }.onFailure {
                                        listening = false
                                        sessionActive = false
                                        error = "Android's platform speech service could not start. Check the installed speech service and try again."
                                    }
                                    return
                                }
                            }
                            sessionActive = false
                            error = "Neither on-device nor Android's platform speech service supports the " + profile.label + " language profile. Install its speech language pack or choose another language."
                            return
                        }
                        sessionActive = false
                        error = when (errorCode) {
                            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is required. Allow it in Android settings, then tap Activate."
                            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Android's speech service needs an internet connection. Check your connection and try again."
                            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "I didn't catch that. Tap Activate and speak again."
                            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Android's speech service is busy. Wait a moment, then tap Activate again."
                            SpeechRecognizer.ERROR_AUDIO -> "Android could not access the microphone audio. Check microphone permission and try again."
                            SpeechRecognizer.ERROR_CLIENT -> "Android stopped the speech session. Tap Activate to start a fresh request."
                            SpeechRecognizer.ERROR_SERVER -> "Android's speech service returned an error. Try again in a moment."
                            else -> "Android speech recognition stopped (code $errorCode). Tap Activate to retry."
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
                                val result = api.chat(ChatRequest(message = spoken, voice = true, history = conversationHistory, clientRequestId = UUID.randomUUID().toString()))
                                val answer = result.body()?.answer
                                if (!sessionActive) return@launch
                                if (result.isSuccessful && !answer.isNullOrBlank()) {
                                    response = answer
                                    pendingDelete = result.body()?.actionConfirmation
                                    conversationHistory = (conversationHistory + listOf(ChatHistoryItem("user", spoken), ChatHistoryItem("assistant", answer))).takeLast(6)
                                    processing = false
                                    try {
                                        val voiceResult = api.speak(mapOf("text" to answer))
                                        val audioBytes = if (voiceResult.isSuccessful) voiceResult.body()?.bytes() else null
                                        if (audioBytes != null && audioBytes.isNotEmpty()) {
                                            val outputFile = File.createTempFile("classdesk-ava-", ".mp3", context.cacheDir)
                                            outputFile.writeBytes(audioBytes)
                                            audioFile = outputFile
                                            val player = MediaPlayer()
                                            audioPlayer = player
                                            player.setDataSource(outputFile.absolutePath)
                                            player.setOnPreparedListener { prepared ->
                                                if (sessionActive) { speaking = true; prepared.start() }
                                                else {
                                                    runCatching { prepared.release() }
                                                    audioPlayer = null
                                                    runCatching { outputFile.delete() }
                                                    audioFile = null
                                                }
                                            }
                                            player.setOnCompletionListener { completed ->
                                                speaking = false
                                                runCatching { completed.release() }
                                                audioPlayer = null
                                                runCatching { outputFile.delete() }
                                                audioFile = null
                                                sessionActive = false
                                            }
                                            player.setOnErrorListener { failed, _, _ ->
                                                speaking = false
                                                runCatching { failed.release() }
                                                audioPlayer = null
                                                runCatching { outputFile.delete() }
                                                audioFile = null
                                                if (sessionActive) speakOnDevice(answer)
                                                true
                                            }
                                            player.prepareAsync()
                                        } else speakOnDevice(answer)
                                    } catch (_: Exception) { speakOnDevice(answer) }
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
        val engine = TextToSpeech(context) { status -> ttsReady = status == TextToSpeech.SUCCESS }
        speech = engine
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { speaking = true }
            override fun onDone(utteranceId: String?) {
                // One tap authorizes one spoken request. The next request requires another tap.
                speaking = false
                sessionActive = false
            }
            override fun onError(utteranceId: String?) {
                speaking = false
                sessionActive = false
                error = "Ava's speech output failed."
            }
        })
        onDispose {
            // Leaving the voice screen always ends the user-started session. Never let a late
            // speech/media callback reopen the microphone after navigation or disposal.
            sessionActive = false
            userStopped = true
            runCatching { recognizer?.cancel() }
            runCatching { recognizer?.destroy() }
            recognizer = null
            runCatching { speech?.stop() }
            runCatching { speech?.shutdown() }
            speech = null
            runCatching { audioPlayer?.stop() }
            runCatching { audioPlayer?.release() }
            audioPlayer = null
            audioFile?.let { runCatching { it.delete() } }
            audioFile = null
            listening = false
            processing = false
            speaking = false
        }
    }

    LaunchedEffect(ttsReady) {
        if (ttsReady) {
            speech?.language = Locale.UK
            val britishVoices = speech?.voices?.filter { it.locale.language == "en" && it.locale.country == "GB" }.orEmpty()
            val preferredVoice = britishVoices.firstOrNull { it.name.contains("female", ignoreCase = true) }
                ?: britishVoices.firstOrNull { !it.isNetworkConnectionRequired }
                ?: britishVoices.firstOrNull()
            if (preferredVoice != null) speech?.voice = preferredVoice
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
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text("RECOGNITION LANGUAGE", color = Color(0xFF91A4B8), fontSize = 9.sp, letterSpacing = 1.sp)
                Text(avaRecognitionLanguageProfiles[selectedLanguageIndex].label, color = Color.White, fontSize = 13.sp)
            }
            Box {
                TextButton(onClick = { languageMenuExpanded = true }) {
                    Text("CHANGE", color = Color(0xFF42D9F5), fontWeight = FontWeight.Bold)
                }
                DropdownMenu(
                    expanded = languageMenuExpanded,
                    onDismissRequest = { languageMenuExpanded = false }
                ) {
                    avaRecognitionLanguageProfiles.forEachIndexed { index, profile ->
                        DropdownMenuItem(
                            text = { Text(profile.label) },
                            onClick = {
                                selectedLanguageIndex = index
                                languageFallbackIndex = 0
                                languageMenuExpanded = false
                                error = null
                            }
                        )
                    }
                }
            }
        }
        Text(
            "AUTOMATIC FALLBACK: Nigerian, British, American and general English; Hausa, Yoruba and Igbo profiles include device-default fallback.",
            color = Color(0xFF91A4B8),
            fontSize = 9.sp
        )
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
        Text("ONE TAP / ONE VOICE REQUEST. TAP ACTIVATE AGAIN FOR YOUR NEXT REQUEST. NO BACKGROUND LISTENING.", color = Color(0xFF91A4B8), fontSize = 9.sp, letterSpacing = 0.6.sp)
    }
    pendingDelete?.let { action ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null; sessionActive = false },
            title = { Text("Confirm permanent deletion") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(action.title, fontWeight = FontWeight.Bold)
                    Text(action.filename, color = Color(0xFF91A4B8))
                    Text("This will delete the database record, extracted text, indexed chunks" + if (action.originalInSharedStorage) " and original shared-storage file." else ".")
                    Text("This action cannot be undone.", color = Color(0xFFFF7D78))
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    scope.launch {
                        try {
                            val result = api.avaTool(mapOf(
                                "action" to "delete_document",
                                "documentId" to action.documentId,
                                "confirmPermanent" to true,
                                "confirmTitle" to action.title
                            ))
                            if (!result.isSuccessful) throw IllegalStateException(result.body()?.get("error")?.toString() ?: "Deletion failed (HTTP " + result.code() + ").")
                            val deleted = result.body()?.get("deleted") as? Map<*, *>
                                ?: throw IllegalStateException("The server did not return a deletion verification result.")
                            if (deleted["databaseRecord"] != true || (action.originalInSharedStorage && deleted["sharedStorageObject"] != true)) {
                                throw IllegalStateException("Deletion was not fully verified. Check the audit log.")
                            }
                            response = "Verified: " + action.title + " was deleted from the ClassDesk database" + if (action.originalInSharedStorage) " and shared storage." else "."
                            pendingDelete = null
                            sessionActive = false
                        } catch (e: Exception) {
                            error = e.message ?: "Permanent deletion failed."
                        }
                    }
                }) { Text("DELETE PERMANENTLY", color = Color(0xFFFF7D78)) }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null; sessionActive = false }) { Text("CANCEL") } }
        )
    }
}
