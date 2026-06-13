plugins {
    id("com.android.application") version "8.9.1"
    id("org.jetbrains.kotlin.android") version "2.1.10"
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.10"
}

android {
    namespace = "no.leiflan.garage"
    compileSdk = 35

    defaultConfig {
        // SAME applicationId as the phone app — required by the Wear Data Layer (Phase 2b). Harmless now.
        applicationId = "no.leiflan.garage"
        minSdk = 30          // Wear OS 3+ (Watch 2R is Wear OS 4/5)
        targetSdk = 34
        // Dev/local default unchanged; CI release overrides both from the vX.Y.Z tag (semver).
        versionCode = System.getenv("VERSION_CODE")?.toIntOrNull() ?: 1
        versionName = System.getenv("VERSION_NAME") ?: "0.1"
    }

    signingConfigs {
        // SAME committed debug keystore as the phone app — required so the Wear Data Layer pairs
        // (phone + watch must share applicationId AND signing key, spec 17). Non-sensitive debug key.
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release { isMinifyEnabled = false }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildFeatures { compose = true }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.01.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.wear.compose:compose-material:1.4.1")
    implementation("androidx.wear.compose:compose-foundation:1.4.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Wear Data Layer — mirror the phone's door state + relay commands (spec 17, Phase 2b).
    implementation("com.google.android.gms:play-services-wearable:18.2.0")
}
