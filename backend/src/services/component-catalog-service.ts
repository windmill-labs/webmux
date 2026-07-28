import { loadComponentCatalog, type ComponentCatalogLoaderDependencies } from "../adapters/component-catalog";
import type { ComponentCatalogConfig, ComponentCatalogState, ComponentDefinition } from "../domain/components";

export class ComponentCatalogService {
  private readonly state: Promise<ComponentCatalogState>;

  constructor(
    config: ComponentCatalogConfig | null,
    projectRoot: string,
    dependencies: ComponentCatalogLoaderDependencies = {},
  ) {
    this.state = loadComponentCatalog(config, projectRoot, dependencies);
  }

  async getState(): Promise<ComponentCatalogState> {
    return await this.state;
  }

  async getComponents(): Promise<ComponentDefinition[]> {
    return (await this.state).components;
  }
}
