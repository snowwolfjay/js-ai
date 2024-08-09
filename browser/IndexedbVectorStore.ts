import { Observable, of } from "rxjs";
import { map, mergeMap, shareReplay } from "rxjs/operators";

interface VectorData {
  id: string;
  vector: number[];
}

class VectorDatabase {
  private db$: Observable<IDBDatabase>;
  private storeName: string;

  constructor(name: string, private size: number) {
    const dbName = "VectorDB";
    this.storeName = `${name}_dim${size}`;
    this.db$ = this.openDatabase(dbName, this.storeName).pipe(shareReplay(1));
  }

  private openDatabase(
    dbName: string,
    storeName: string
  ): Observable<IDBDatabase> {
    return new Observable<IDBDatabase>((observer) => {
      const request = indexedDB.open(dbName);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          const store = db.createObjectStore(storeName, { keyPath: "id" });
        }
      };

      request.onsuccess = () => {
        observer.next(request.result);
        observer.complete();
      };

      request.onerror = () => {
        observer.error(request.error);
      };
    });
  }

  private getObjectStore(mode: IDBTransactionMode): Observable<IDBObjectStore> {
    return this.db$.pipe(
      map((db) =>
        db.transaction([this.storeName], mode).objectStore(this.storeName)
      )
    );
  }

  private normalizeVector(vector: number[]): number[] {
    if (vector.length > this.size) {
      return vector.slice(0, this.size);
    } else if (vector.length < this.size) {
      return [...vector, ...new Array(this.size - vector.length).fill(0)];
    }
    return vector;
  }

  addVectors(vectors: VectorData[]): Observable<void> {
    return this.getObjectStore("readwrite").pipe(
      mergeMap((store) => {
        vectors.forEach((vectorData) => {
          const normalizedVector = this.normalizeVector(vectorData.vector);
          store.put({ id: vectorData.id, vector: normalizedVector });
        });
        return of(undefined);
      })
    );
  }

  removeVectors(ids: string[]): Observable<void> {
    return this.getObjectStore("readwrite").pipe(
      mergeMap((store) => {
        ids.forEach((id) => store.delete(id));
        return of(undefined);
      })
    );
  }

  updateVectors(vectors: VectorData[]): Observable<void> {
    return this.addVectors(vectors);
  }

  search(queryVector: number[], topK: number): Observable<VectorData[]> {
    const normalizedQueryVector = this.normalizeVector(queryVector);

    return this.getObjectStore('readonly').pipe(
      mergeMap((store) => {
        const results: Array<{ id: string; vector: number[]; similarity: number }> = [];
        let minSimilarity = 0; // 当前最小的相似度
        const request = store.openCursor();

        return new Observable<VectorData[]>((observer) => {
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor && !observer.closed) {
              const vectorData = cursor.value as VectorData;
              const similarity = this.computeCosineSimilarity(normalizedQueryVector, vectorData.vector);

              // 如果results未满，直接添加并更新最小相似度
              if (results.length < topK) {
                results.push({ id: vectorData.id, vector: vectorData.vector, similarity });
                if (results.length === topK) {
                  // 当达到topK时，确定最小相似度
                  minSimilarity = Math.min(...results.map(r => r.similarity));
                }
              } else if (similarity > minSimilarity) {
                // 如果新相似度高于当前最小相似度，替换并更新最小相似度
                let minIndex = 0;
                results.forEach((result, index) => {
                  if (result.similarity === minSimilarity) {
                    minIndex = index;
                  }
                });
                results[minIndex] = { id: vectorData.id, vector: vectorData.vector, similarity };
                minSimilarity = Math.min(...results.map(r => r.similarity));
              }

              cursor.continue();
            } else {
              // 游标遍历完毕或observer已关闭，完成操作
              observer.next(results);
              observer.complete();
            }
          };

          request.onerror = () => {
            observer.error(request.error);
          };
        });
      })
    );
  }


  clear(): Observable<void> {
    return this.getObjectStore("readwrite").pipe(
      mergeMap((store) => {
        const request = store.clear();

        return new Observable<void>((observer) => {
          request.onsuccess = () => {
            observer.next();
            observer.complete();
          };

          request.onerror = () => {
            observer.error(request.error);
          };
        });
      })
    );
  }

  private computeCosineSimilarity(vec1: number[], vec2: number[]): number {
    const dotProduct = vec1.reduce((acc, val, idx) => acc + val * vec2[idx], 0);
    const magnitudeA = Math.sqrt(vec1.reduce((acc, val) => acc + val * val, 0));
    const magnitudeB = Math.sqrt(vec2.reduce((acc, val) => acc + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }
}

// 示例使用：
// const db = new VectorDatabase("myVectors", 4);

// db.addVectors([
//   { id: "v1", vector: [0.1, 0.2, 0.3, 0.4] },
//   { id: "v2", vector: [0.5, 0.6] },
//   { id: "v3", vector: [0.7, 0.8, 0.9, 1.0, 1.1] },
// ]).subscribe({
//   next: () => console.log("Vectors added successfully"),
//   error: (err) => console.error("Error adding vectors", err),
// });

// db.search([0.1, 0.2, 0.3], 2).subscribe({
//   next: (results) => console.log("Search results:", results),
//   error: (err) => console.error("Search error", err),
// });

// db.clear().subscribe({
//   next: () => console.log("Database cleared successfully"),
//   error: (err) => console.error("Error clearing database", err),
// });
