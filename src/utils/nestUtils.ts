import dashify from "dashify";
import * as path from "node:path";
import { pascalCase } from "pascal-case";

export class ControllerName {
    /** Short name without `Controller` */
    public readonly shortName: string;
    public readonly slug: string;
    public readonly className: string;
    public readonly fileName: string;
    public readonly filePath: string;

    public constructor(shortName: string, directoryPath: string) {
        this.shortName = pascalCase(shortName.replace(/controller$/i, ""));
        this.slug = dashify(this.shortName);
        this.className = this.shortName + "Controller";
        this.fileName = `${this.slug}.controller.ts`;
        this.filePath = path.join(directoryPath, this.fileName);
    }
}
