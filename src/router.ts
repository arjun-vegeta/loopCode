import type { Task } from './types.js';

export interface ModelRoute {
  providerID: string;
  modelID: string;
}

export class Router {
  private defaultModel: ModelRoute;
  private planningModel: ModelRoute;
  private verificationModel: ModelRoute;

  constructor(config?: { default?: ModelRoute; planning?: ModelRoute; verification?: ModelRoute }) {
    this.defaultModel = config?.default || { providerID: 'anthropic', modelID: 'claude-5-sonnet' };
    this.planningModel = config?.planning || { providerID: 'anthropic', modelID: 'claude-4.8-opus' };
    this.verificationModel = config?.verification || { providerID: 'anthropic', modelID: 'claude-5-sonnet' };
  }

  /**
   * Route a task to the appropriate model based on structured categories and rules.
   */
  route(task: Task): ModelRoute {
    // Check if user set an explicit override in the task itself
    if (task.model) {
      const parts = task.model.split('/');
      if (parts.length === 2) {
        return { providerID: parts[0], modelID: parts[1] };
      }
    }

    // Step 2.3 Fix: Route off the structured category field
    switch (task.category) {
      case 'test':
      case 'docs':
        return { providerID: 'anthropic', modelID: 'claude-5-sonnet' };

      case 'security':
      case 'refactor':
        return { providerID: 'anthropic', modelID: 'claude-4.8-opus' };

      case 'feature':
      case 'fix':
        // File count heuristic: if task makes complex changes, route to stronger model
        if (task.expectedOutputs.length > 2) {
          return { providerID: 'anthropic', modelID: 'claude-4.8-opus' };
        }
        return { providerID: 'anthropic', modelID: 'claude-5-sonnet' };

      default:
        return this.defaultModel;
    }
  }

  getPlanningModel(): ModelRoute {
    return this.planningModel;
  }

  getVerificationModel(): ModelRoute {
    return this.verificationModel;
  }
}
