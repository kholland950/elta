import com.moowork.gradle.node.npm.NpmTask
import com.github.jengelman.gradle.plugins.shadow.tasks.ShadowJar

val logback_version: String by project
val ktor_version: String by project
val kotlin_version: String by project

repositories {
    mavenLocal()
    jcenter()
    mavenCentral()
}

dependencies {
    implementation("org.jetbrains.kotlin:kotlin-stdlib-jdk8:$kotlin_version")
    implementation("io.ktor:ktor-server-netty:$ktor_version")
    implementation("ch.qos.logback:logback-classic:$logback_version")
    implementation("io.ktor:ktor-server-core:$ktor_version")
    implementation("io.ktor:ktor-mustache:$ktor_version")
    implementation("io.ktor:ktor-server-host-common:$ktor_version")
    implementation("io.ktor:ktor-locations:$ktor_version")
    implementation("io.ktor:ktor-server-sessions:$ktor_version")
    implementation("io.ktor:ktor-websockets:$ktor_version")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-core:1.0.1")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.0.1")
    testImplementation("io.ktor:ktor-server-tests:$ktor_version")
}

plugins {
    application
    kotlin("jvm") version "1.4.10"
    kotlin("plugin.serialization") version "1.4.10"
    id("com.github.johnrengelman.shadow") version "5.0.0"

    base
    id("com.github.node-gradle.node") version "2.2.4"
}

group = "com.kholland"
version = "0.0.1-SNAPSHOT"

application {
    mainClassName = "io.ktor.server.netty.EngineMain"
}

tasks.withType<ShadowJar>() {
    baseName = "app"
    classifier = ""
    version = ""
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

tasks.named("classes") {
    dependsOn("npm_run_build")
}

tasks.named("clean") {
    doFirst {
        delete("frontend/dist")
    }
}
