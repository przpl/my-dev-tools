import _ from "lodash";
import * as path from "node:path";

export class ControllerName {
    /** Short name without `Controller` */
    public readonly shortName: string;
    public readonly slug: string;
    public readonly className: string;
    public readonly fileName: string;
    public readonly filePath: string;

    public constructor(shortName: string, directoryPath: string) {
        this.shortName = _.upperFirst(_.camelCase(shortName.replace(/controller$/i, "")));
        this.slug = _.kebabCase(this.shortName);
        this.className = this.shortName + "Controller";
        this.fileName = `${this.slug}.controller.ts`;
        this.filePath = path.join(directoryPath, this.fileName);
    }
}
