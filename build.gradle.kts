import com.moowork.gradle.node.npm.NpmTask
import com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar

val logbackVersion: String by project
val ktorVersion: String by project
val kotlinVersion: String by project

repositories {
    mavenLocal()
    mavenCentral()
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib:$kotlinVersion")
    implementation("org.jetbrains.kotlin:kotlin-test:$kotlinVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("ch.qos.logback:logback-classic:$logbackVersion")
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-mustache:$ktorVersion")
    implementation("io.ktor:ktor-server-host-common:$ktorVersion")
    implementation("io.ktor:ktor-locations:$ktorVersion")
    implementation("io.ktor:ktor-server-sessions:$ktorVersion")
    implementation("io.ktor:ktor-websockets:$ktorVersion")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-core:1.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.0.1")
    testImplementation("io.ktor:ktor-server-tests:$ktorVersion")
}

plugins {
    application
    kotlin("jvm") version "1.9.10"
    kotlin("plugin.serialization") version "1.9.10"
    id("com.github.johnrengelman.shadow") version "8.0.0"

    base
    id("com.github.node-gradle.node") version "2.2.4"
}

group = "com.kholland"
version = "0.0.1-SNAPSHOT"

application {
    mainClass.set("io.ktor.server.netty.EngineMain")
}

tasks.withType<ShadowJar>() {
    archiveBaseName.set("app")
    archiveClassifier.set("")
    archiveVersion.set("")
}

kotlin.sourceSets["main"].kotlin.srcDirs("src")
kotlin.sourceSets["test"].kotlin.srcDirs("test")

sourceSets["main"].resources.srcDirs("resources", "frontend/dist")
sourceSets["test"].resources.srcDirs("testresources")

defaultTasks("run")

node {
    /* gradle-node-plugin configuration
       https://github.com/srs/gradle-node-plugin/blob/master/docs/node.md
       Task name pattern:
       ./gradlew npm_<command> Executes an NPM command.
    */

    // Version of node to use.
    version = "15.2.0"

    // Version of npm to use.
    npmVersion = ""

    // If true, it will download node using above parameters.
    // If false, it will try to use globally installed node.
    download = true

    nodeModulesDir = file("frontend/")
}

tasks.named<NpmTask>("npm_run_build") {
    // make sure the build task is executed only when appropriate files change
    inputs.files(fileTree("frontend/src"))

    // "node_modules" appeared not reliable for dependency change detection (the task was rerun without changes)
    // though "package.json" and "package-lock.json" should be enough anyway
    inputs.file("frontend/package.json")
    inputs.file("frontend/package-lock.json")

    outputs.dir("frontend/dist")
}

tasks.named("processResources") {
  dependsOn("npm_run_build")
}

tasks.named("classes") {
    dependsOn("npm_run_build")
}

tasks.named("clean") {
    doFirst {
        delete("frontend/dist")
    }
}
