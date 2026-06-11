plugins {
    id("com.android.application") version "8.9.1"
    id("org.jetbrains.kotlin.android") version "2.1.10"
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.10"
}

android {
    namespace = "no.leiflan.garage"
    compileSdk = 35

    defaultConfig {
        applicationId = "no.leiflan.garage"
        minSdk = 35
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
    }

    signingConfigs {
        // §8 (NEW-PROJECT-GUIDE): sign debug with a STABLE keystore so app updates don't wipe data.
        // CI exports DEBUG_KEYSTORE_FILE (decoded from the DEBUG_KEYSTORE secret) and we use it
        // explicitly here rather than trusting AGP's default-location magic. Local builds leave the env
        // unset → AGP's normal debug keystore.
        getByName("debug") {
            System.getenv("DEBUG_KEYSTORE_FILE")?.let { ks ->
                val f = file(ks)
                if (f.exists()) {
                    storeFile = f
                    storePassword = "android"
                    keyAlias = "androiddebugkey"
                    keyPassword = "android"
                }
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.01.01"))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    // repeatOnLifecycle gating of the poll loop (keepalive-churn fix, NEW-PROJECT-GUIDE §5)
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")
    // Background periodic-wake (spec 16): WorkManager periodic check + AlarmManager exact alarm.
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    // Remote path: plain Paho mqttv3 (not the deprecated paho-android-service); WSS built in.
    implementation("org.eclipse.paho:org.eclipse.paho.client.mqttv3:1.2.5")
    // JVM unit tests for the pure logic (decide / labels / door model / cert builder).
    testImplementation("junit:junit:4.13.2")
}
