package com.kyro.classdesk

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.graphics.Color
import com.kyro.classdesk.ui.ClassDeskApp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(10, 16, 25)
        window.navigationBarColor = android.graphics.Color.rgb(10, 16, 25)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme(
                primary = Color(0xFF42D9F5),
                secondary = Color(0xFFF2C94C),
                background = Color(0xFF0A1019),
                surface = Color(0xFF111B28)
            )) { ClassDeskApp() }
        }
    }
}
