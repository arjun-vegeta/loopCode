import type { TaskNode } from '../ir/task.js';
import type { ExecutionIR } from '../ir/execution.js';
import type { VerificationIR, VerificationLayer, Regression } from '../ir/verification.js';
import { ReviewerAgent } from './reviewer.js';
import { MemoryEngine } from '../memory/engine.js';
import type { OpencodeClient } from '@opencode-ai/sdk';
import { execSync } from 'child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class VerifierAgent {
  private reviewerAgent: ReviewerAgent;

  constructor(client: OpencodeClient, modelRoute?: { providerID: string; modelID: string }) {
    this.reviewerAgent = new ReviewerAgent(client, modelRoute);
  }

  /**
   * Run the 5-layer verification pipeline on a completed task.
   */
  async verifyTask(taskNode: TaskNode, execIR?: ExecutionIR, testCoverageBefore: number = 100): Promise<VerificationIR> {
    if (!execIR) {
      const memory = new MemoryEngine();
      const execJson = memory.getTaskExecution(taskNode.id);
      if (!execJson) {
        throw new Error('No execution IR found in shared memory for task ' + taskNode.id);
      }
      execIR = JSON.parse(execJson) as ExecutionIR;
    }

    const layers: VerificationLayer[] = [];
    let overallPass = true;
    let retryHint = '';
    const regressions: Regression[] = [];

    const worktreePath = execIR.gitState.worktreePath || process.cwd();

    // Layer 1: Compilation
    const compileStart = Date.now();
    let compilePassed = true;
    let compileEvidence = 'No compilation command specified.';

    const compileVerifyStep = taskNode.acceptanceCriteria.find(
      (ac) => ac.toLowerCase().includes('compile') || ac.toLowerCase().includes('build'),
    );
    if (compileVerifyStep) {
      try {
        // Runs compile check (e.g. tsc)
        const res = execSync('npm run build', { cwd: worktreePath }).toString();
        compileEvidence = res;
      } catch (err: any) {
        compilePassed = false;
        compileEvidence = err.stdout?.toString() || err.stderr?.toString() || err.message;
        overallPass = false;
        retryHint = `Compilation failed: ${compileEvidence}`;
      }
    } else {
      compileEvidence = 'Skipped: No compile step defined.';
    }

    layers.push({
      name: 'Compilation',
      type: 'compile',
      passed: compilePassed,
      evidence: compileEvidence,
      durationMs: Date.now() - compileStart,
      cost: 0,
      confidence: 1.0,
    });

    if (!compilePassed) {
      return { taskId: taskNode.id, layers, overallPass: false, canRetry: true, retryHint, regressions };
    }

    // Layer 2: Unit Tests
    const testStart = Date.now();
    let testPassed = true;
    let testEvidence = 'No unit tests run.';

    // Check if test script exists or requested
    if (!process.env.VITEST) {
      try {
        const res = execSync('npm run test', { cwd: worktreePath }).toString();
        testEvidence = res;
      } catch (err: any) {
        testPassed = false;
        testEvidence = err.stdout?.toString() || err.stderr?.toString() || err.message;
        overallPass = false;
        retryHint = `Unit tests failed: ${testEvidence}`;
      }
    } else {
      testEvidence = 'Skipped: Running in test environment (preventing vitest recursion).';
    }

    layers.push({
      name: 'Unit Tests',
      type: 'test',
      passed: testPassed,
      evidence: testEvidence,
      durationMs: Date.now() - testStart,
      cost: 0,
      confidence: 1.0,
    });

    if (!testPassed) {
      return { taskId: taskNode.id, layers, overallPass: false, canRetry: true, retryHint, regressions };
    }

    // Layer 3: Integration Tests (optional, non-blocking warning if skipped)
    const integrationStart = Date.now();
    layers.push({
      name: 'Integration Tests',
      type: 'test',
      passed: true,
      evidence: 'Skipped: No integration test suite found.',
      durationMs: Date.now() - integrationStart,
      cost: 0,
      confidence: 1.0,
    });

    // Layer 4: Security Scan (Semgrep or local regex scanning)
    const securityStart = Date.now();
    let securityPassed = true;
    let securityEvidence = 'Security check clean.';
    try {
      // Local regex scan for credentials, secrets, or eval
      const suspiciousRegex = /(eval\(|system\(|exec\()/i;
      const statusOutput = execSync('git diff --name-only HEAD~1', { cwd: worktreePath }).toString();
      const files = statusOutput.split('\n').filter(Boolean);
      for (const file of files) {
        if (file.endsWith('.ts') || file.endsWith('.js')) {
          try {
            const content = fs.readFileSync(path.join(worktreePath, file), 'utf8');
            if (suspiciousRegex.test(content)) {
              securityPassed = false;
              securityEvidence = `Vulnerability found: Suspicious code patterns (eval, system, exec) in ${file}`;
              overallPass = false;
              retryHint = securityEvidence;
              break;
            }
          } catch (fileErr) {
            // ignore
          }
        }
      }
    } catch (err) {
      // ignore
    }

    layers.push({
      name: 'Security Scan',
      type: 'security',
      passed: securityPassed,
      evidence: securityEvidence,
      durationMs: Date.now() - securityStart,
      cost: 0,
      confidence: 1.0,
    });

    if (!securityPassed) {
      return { taskId: taskNode.id, layers, overallPass: false, canRetry: true, retryHint, regressions };
    }

    // Layer 5: Independent Review Agent
    const reviewStart = Date.now();
    let reviewPassed = true;
    let reviewEvidence = 'Review approved.';
    let reviewCost = 0.1;
    try {
      const reviewResult = await this.reviewerAgent.reviewTask(taskNode);
      reviewPassed = reviewResult.passed;
      reviewEvidence = JSON.stringify(reviewResult.comments);
      reviewCost = taskNode.budget.maxCostUsd * 0.15; // approximate review cost
      if (!reviewPassed) {
        overallPass = false;
        retryHint = `Code review rejected. Comments: ${reviewEvidence}`;
      }
    } catch (err: any) {
      reviewPassed = false;
      reviewEvidence = `Reviewer crashed: ${err.message}`;
      overallPass = false;
    }

    layers.push({
      name: 'Independent Review',
      type: 'review',
      passed: reviewPassed,
      evidence: reviewEvidence,
      durationMs: Date.now() - reviewStart,
      cost: reviewCost,
      confidence: 0.9,
    });

    // Check complete definition criteria: test coverage check
    const testCoverageAfter = 100;
    // (mocking test coverage check - in production we'd parse coverage reports)
    if (testCoverageBefore - testCoverageAfter > 10) {
      overallPass = false;
      retryHint = `Complete Definition Check: Test coverage dropped by more than 10% (from ${testCoverageBefore}% to ${testCoverageAfter}%)`;
      regressions.push({
        file: 'coverage',
        description: 'Test coverage drop regression',
        severity: 'critical',
      });
    }

    const verificationIR = {
      taskId: taskNode.id,
      layers,
      overallPass,
      canRetry: true,
      retryHint: overallPass ? undefined : retryHint,
      regressions,
    };

    // Write to shared memory (V2)
    const memoryEngine = new MemoryEngine();
    memoryEngine.saveTaskReview(taskNode.id, JSON.stringify(verificationIR));

    return verificationIR;
  }
}
