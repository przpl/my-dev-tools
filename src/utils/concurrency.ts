/** Maps `items` in order while keeping at most `limit` calls to `map` in flight. */
export async function mapWithLimit<T, R>(items: T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const index = next++;
            results[index] = await map(items[index]);
        }
    };

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
}
