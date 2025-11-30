import { Project, SourceFile } from "ts-morph";

/**
 * Centralized manager for ts-morph Project instances.
 * Provides singleton pattern to avoid creating multiple Project instances.
 */
export class ProjectManager {
    private static inMemoryProject: Project | null = null;
    private static fileSystemProject: Project | null = null;

    /**
     * Get a Project instance that uses in-memory file system.
     * Use for parsing/analyzing code without modifying actual files.
     */
    static getInMemoryProject(): Project {
        if (!this.inMemoryProject) {
            this.inMemoryProject = new Project({ useInMemoryFileSystem: true });
        }
        return this.inMemoryProject;
    }

    /**
     * Get a Project instance that works with the actual file system.
     * Use when you need to read/write actual files.
     */
    static getFileSystemProject(): Project {
        if (!this.fileSystemProject) {
            this.fileSystemProject = new Project();
        }
        return this.fileSystemProject;
    }

    /**
     * Create a temporary source file for analysis.
     * Automatically cleans up previous temp files with the same name.
     */
    static createTempSourceFile(fileName: string, content: string): SourceFile {
        const project = this.getInMemoryProject();
        return project.createSourceFile(fileName, content, { overwrite: true });
    }

    /**
     * Removes a source file from the in-memory project after all processing is complete.
     * 
     * This method should only be called when the source file is no longer needed.
     * Calling this prematurely will make the source file unavailable for further analysis or manipulation.
     * 
     * @param sourceFile The SourceFile to forget.
     */
    static forgetSourceFile(sourceFile: SourceFile): void {
        sourceFile.forget();
    }

    /**
     * Reset all projects (useful for testing or memory cleanup).
     */
    static reset(): void {
        this.inMemoryProject = null;
        this.fileSystemProject = null;
    }
}
