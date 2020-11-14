import com.moowork.gradle.node.NodeExtension
import com.moowork.gradle.node.npm.NpmTask

buildscript {
    repositories {
        mavenCentral()
        maven(url = "https://plugins.gradle.org/m2/")
    }

    dependencies {
        classpath("com.github.node-gradle:gradle-node-plugin:2.2.4")
    }
}

plugins {
    base
    id("com.github.node-gradle.node") version "2.2.4"
}

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
}

tasks.named<NpmTask>("npm_run_build") {
    // make sure the build task is executed only when appropriate files change
    inputs.files(fileTree("public"))
    inputs.files(fileTree("src"))

    // "node_modules" appeared not reliable for dependency change detection (the task was rerun without changes)
    // though "package.json" and "package-lock.json" should be enough anyway
    inputs.file("package.json")
    inputs.file("package-lock.json")

    outputs.dir("build")
}

// pack output of the build into JAR file
val packageFrontend by tasks.registering(Jar::class) {
    dependsOn("npm_run_build")
    archiveBaseName.set("frontend")
    archiveExtension.set("jar")
    destinationDirectory.set(file("${projectDir}/build_packageFrontend"))
    from("build") {
        // optional path under which output will be visible in Java classpath, e.g. static resources path
        into("static")
    }
}

// declare a dedicated scope for publishing the packaged JAR
val npmResources by configurations.creating

configurations.named("default").get().extendsFrom(npmResources)

// expose the artifact created by the packaging task
artifacts {
    add(npmResources.name, packageFrontend.get().archivePath) {
        builtBy(packageFrontend)
        type = "jar"
    }
}

tasks.assemble {
    dependsOn(packageFrontend)
}

tasks.clean {
    delete(packageFrontend.get().archivePath)
}
