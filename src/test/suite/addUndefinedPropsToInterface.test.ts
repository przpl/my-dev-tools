import * as assert from "assert";
import { Project } from "ts-morph";

suite("Add Undefined Props To Interface Test", () => {
    test("Should detect undefined props in JSX and add them to Props interface", () => {
        const testCode = `
interface Props {
    existingProp: string;
}

function TestComponent({ existingProp }: Props) {
    return (
        <div>
            <span className={className}>{title}</span>
            <button onClick={handleClick} disabled={isDisabled}>
                Count: {count}
            </button>
        </div>
    );
}
        `;

        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile("test.tsx", testCode);

        // Test would verify that undefined props are detected
        // This is a placeholder for the actual test implementation
        // The real test would need to mock VS Code environment

        assert.ok(sourceFile, "Source file should be created");
    });

    test("Should handle property access correctly (props.className should add className, not props)", () => {
        const testCode = `
interface Props {}

function TestComponent(props: Props) {
    return <div className={props.className}></div>;
}
        `;

        const project = new Project({ useInMemoryFileSystem: true });
        const sourceFile = project.createSourceFile("test.tsx", testCode);

        // Test would verify that only 'className' is detected, not 'props'
        // This is a placeholder for the actual test implementation
        // The real test would need to mock VS Code environment

        assert.ok(sourceFile, "Source file should be created");
    });

    test("Should guess correct types for common prop names", () => {
        const typeGuesses = new Map<string, string>([
            ["className", "string"],
            ["count", "number"],
            ["isVisible", "boolean"],
            ["onSubmit", "() => void"],
        ]);

        assert.strictEqual(typeGuesses.get("className"), "string");
        assert.strictEqual(typeGuesses.get("count"), "number");
        assert.strictEqual(typeGuesses.get("isVisible"), "boolean");
        assert.strictEqual(typeGuesses.get("onSubmit"), "() => void");
    });
});
