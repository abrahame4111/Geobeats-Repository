# 🔧 Quick Fix for Build Error

## The Problem
```
Cannot resolve external dependency com.android.tools.build:gradle:8.0.1 because no repositories are defined.
```

## The Solution

Edit the file: `android\build.gradle`

Add the `repositories` block inside `buildscript`:

### ✅ CORRECT VERSION (Use This):

```gradle
buildscript {
    ext {
        buildToolsVersion = "33.0.0"
        minSdkVersion = 21
        compileSdkVersion = 33
        targetSdkVersion = 33
        ndkVersion = "23.1.7779620"
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.0.1")
        classpath("com.facebook.react:react-native-gradle-plugin")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        maven { url "https://www.jitpack.io" }
    }
}
```

## Steps:

1. Open `android\build.gradle` in any text editor
2. Find the `buildscript` section
3. Add these lines after the `ext` block and before `dependencies`:
   ```gradle
   repositories {
       google()
       mavenCentral()
   }
   ```
4. Save the file
5. Run the build again:
   ```powershell
   npx react-native run-android
   ```

## Or Copy-Paste This Complete File:

Replace the entire contents of `android\build.gradle` with:

```gradle
buildscript {
    ext {
        buildToolsVersion = "33.0.0"
        minSdkVersion = 21
        compileSdkVersion = 33
        targetSdkVersion = 33
        ndkVersion = "23.1.7779620"
    }
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.0.1")
        classpath("com.facebook.react:react-native-gradle-plugin")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        maven { url "https://www.jitpack.io" }
    }
}
```

That's it! This should fix the "no repositories defined" error.
