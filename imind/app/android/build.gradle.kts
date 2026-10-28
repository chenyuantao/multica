allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}

// Keep network-specific repositories out of Flutter's included plugin build.
if (System.getenv("IMIND_MAVEN_MIRROR") == "aliyun") {
    gradle.projectsEvaluated {
        allprojects {
            repositories {
                clear()
                maven("https://maven.aliyun.com/repository/google")
                maven("https://maven.aliyun.com/repository/central")
                maven("https://storage.flutter-io.cn/download.flutter.io")
            }
        }
    }
}
