package com.kyro.classdesk.ui

import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

@Composable
fun BiometricLockScreen(
    activity: FragmentActivity?,
    onUnlocked: () -> Unit,
    onPasswordFallback: () -> Unit
) {
    var message by remember { mutableStateOf("Unlock ClassDesk with your phone's fingerprint or screen lock.") }
    var promptOpen by remember { mutableStateOf(false) }
    val authenticators = remember {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            BiometricManager.Authenticators.BIOMETRIC_STRONG or BiometricManager.Authenticators.DEVICE_CREDENTIAL
        } else BiometricManager.Authenticators.BIOMETRIC_STRONG
    }
    val canAuthenticate = remember(activity) {
        activity != null && BiometricManager.from(activity).canAuthenticate(authenticators) == BiometricManager.BIOMETRIC_SUCCESS
    }

    fun authenticate() {
        val host = activity
        if (host == null || !canAuthenticate) {
            message = "A supported fingerprint or device lock is not available. Sign in with your ClassDesk password."
            return
        }
        val prompt = BiometricPrompt(
            host,
            ContextCompat.getMainExecutor(host),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    promptOpen = false
                    message = "Device authentication successful."
                    onUnlocked()
                }
                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    promptOpen = false
                    message = errString.toString()
                }
                override fun onAuthenticationFailed() {
                    message = "That did not match. Try again."
                }
            }
        )
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Unlock AFIT ClassDesk")
            .setSubtitle("Verify with your fingerprint or phone screen lock")
            .setAllowedAuthenticators(authenticators)
            .build()
        promptOpen = true
        prompt.authenticate(info)
    }

    Column(
        Modifier.fillMaxSize().background(Color(0xFF0A1019)).padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("AFIT / CLASSDESK", color = Color(0xFF42D9F5), fontSize = 11.sp, letterSpacing = 2.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(24.dp))
        Text("Welcome back.", color = Color.White, fontSize = 29.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(8.dp))
        Text("CLASS REPRESENTATIVE ACCESS", color = Color(0xFFF2C94C), fontSize = 10.sp, letterSpacing = 1.5.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(18.dp))
        Text(message, color = Color(0xFF91A4B8), fontSize = 13.sp)
        Spacer(Modifier.height(26.dp))
        Button(
            onClick = { authenticate() },
            enabled = !promptOpen && canAuthenticate,
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(7.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF42D9F5), contentColor = Color(0xFF0A1019))
        ) { Text("UNLOCK WITH PHONE SECURITY", fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 6.dp)) }
        Spacer(Modifier.height(10.dp))
        OutlinedButton(onClick = onPasswordFallback, modifier = Modifier.fillMaxWidth()) {
            Text("SIGN IN WITH PASSWORD INSTEAD", color = Color(0xFFF2C94C))
        }
        Spacer(Modifier.height(18.dp))
        Text("This lock applies only to the Android app. The website login is unchanged.", color = Color(0xFF91A4B8), fontSize = 10.sp)
    }
}
