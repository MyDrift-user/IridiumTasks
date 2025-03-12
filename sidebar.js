let tasks = {};

// Initialize tasks from storage
chrome.storage.local.get(['tasks'], (result) => {
    tasks = result.tasks || {
        'todo': [],
        'in-progress': [],
        'done': []
    };
    renderTasks();
});

// Replace the add task handler
document.getElementById('add-task').addEventListener('click', () => {
    const taskId = Date.now();
    const taskEl = createEditableTask(taskId);
    
    const todoTasksDiv = document.querySelector('#todo .tasks');
    todoTasksDiv.insertBefore(taskEl, todoTasksDiv.firstChild);
    
    const input = taskEl.querySelector('.task-input');
    input.focus();
});

function createEditableTask(id) {
    const taskEl = document.createElement('div');
    taskEl.classList.add('task', 'editing');
    taskEl.draggable = false;
    taskEl.dataset.id = id;

    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('task-input');
    input.placeholder = 'Enter task description';

    input.addEventListener('blur', () => {
        if (input.value.trim()) {
            const task = {
                id: id,
                text: input.value.trim(),
                column: 'todo'
            };
            tasks['todo'].push(task);
            saveTasks();
            renderTasks();
        } else {
            taskEl.remove();
        }
    });

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        }
    });

    taskEl.appendChild(input);
    return taskEl;
}

function renderTasks() {
    Object.keys(tasks).forEach(column => {
        const tasksDiv = document.querySelector(`#${column} .tasks`);
        tasksDiv.innerHTML = '';
        tasks[column].forEach(task => {
            const taskEl = document.createElement('div');
            taskEl.classList.add('task');
            taskEl.draggable = true;
            taskEl.dataset.id = task.id;
            
            const deleteBtn = document.createElement('button');
            deleteBtn.classList.add('delete-task');
            deleteBtn.innerHTML = '&times;';
            deleteBtn.addEventListener('click', () => deleteTask(task.id, column));
            
            const textContent = document.createElement('p');
            textContent.textContent = task.text;
            
            taskEl.appendChild(deleteBtn);
            taskEl.appendChild(textContent);
            
            // Add double click handler with check for editing mode
            taskEl.addEventListener('dblclick', (e) => {
                if (!taskEl.classList.contains('editing')) {
                    makeTaskEditable(taskEl, task);
                }
                e.stopPropagation(); // Prevent double-click from bubbling
            });
            
            tasksDiv.appendChild(taskEl);
        });
    });
}

function makeTaskEditable(taskEl, task) {
    taskEl.draggable = false;
    taskEl.classList.add('editing');
    const input = document.createElement('input');
    input.type = 'text';
    input.classList.add('task-input');
    input.value = task.text;
    taskEl.textContent = '';
    taskEl.appendChild(input);
    input.focus();

    input.addEventListener('blur', () => {
        finishEditing(taskEl, task, input.value.trim());
    });

    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            input.blur();
        }
    });
}

function finishEditing(taskEl, task, newText) {
    if (newText && newText !== task.text) {
        task.text = newText;
        saveTasks();
    }
    renderTasks();
}

function saveTasks() {
    chrome.storage.local.set({ tasks });
}

let draggedTask = null;
let draggedTaskData = null;
let dragOffset = { x: 0, y: 0 };

document.addEventListener('dragstart', e => {
    if (!e.target.classList.contains('task')) return;
    
    draggedTask = e.target;
    const taskId = parseInt(draggedTask.dataset.id);
    const columnId = draggedTask.closest('.column').id;
    
    // Store task data before modifying the DOM
    draggedTaskData = {
        id: taskId,
        column: columnId,
        task: tasks[columnId].find(t => t.id === taskId)
    };
    
    const rect = draggedTask.getBoundingClientRect();
    const tasksRect = draggedTask.closest('.tasks').getBoundingClientRect();
    
    dragOffset = {
        y: e.clientY - rect.top,
        x: tasksRect.left
    };
    
    const ghost = document.createElement('div');
    e.dataTransfer.setDragImage(ghost, 0, 0);
    
    requestAnimationFrame(() => {
        draggedTask.classList.add('dragging');
        updateDragPosition(e.clientX, e.clientY);
    });
});

document.addEventListener('drag', e => {
    if (!draggedTask || !e.clientX || !e.clientY) return;
    
    updateDragPosition(e.clientX, e.clientY);
    
    // Remove highlight from all columns and tasks containers
    document.querySelectorAll('.column, .tasks').forEach(el => {
        el.classList.remove('drag-over');
    });
    
    // Find target tasks container and highlight
    const targetTasks = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tasks');
    if (targetTasks) {
        targetTasks.classList.add('drag-over');
        targetTasks.closest('.column').classList.add('drag-over');
        handleColumnDrag(targetTasks, e.clientY);
    }
});

function updateDragPosition(x, y) {
    if (!draggedTask) return;
    draggedTask.style.left = `${dragOffset.x}px`;
    draggedTask.style.top = `${y - dragOffset.y}px`;
}

function handleColumnDrag(column, clientY) {
    const columnTasks = Array.from(column.children).filter(
        el => el.classList.contains('task') && !el.classList.contains('dragging')
    );
    
    if (columnTasks.length === 0) {
        // Empty column, no need to calculate positions
        return;
    }
    
    columnTasks.forEach(task => {
        const rect = task.getBoundingClientRect();
        const middle = rect.top + rect.height / 2;
        task.classList.remove('shift-up', 'shift-down');
        
        if (clientY < middle) {
            task.classList.add('shift-down');
        } else if (clientY > middle) {
            const nextTask = task.nextElementSibling;
            if (!nextTask || !nextTask.classList.contains('task')) {
                task.classList.add('shift-up');
            }
        }
    });
}

document.addEventListener('dragend', e => {
    if (!draggedTask || !draggedTaskData) return;
    
    // Reset position styles immediately
    draggedTask.style.left = '';
    draggedTask.style.top = '';
    draggedTask.classList.remove('dragging');
    
    // Find target tasks container
    const targetTasks = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tasks');
    if (targetTasks) {
        const targetColumn = targetTasks.closest('.column');
        const columnTasks = Array.from(targetTasks.children)
            .filter(el => el.classList.contains('task'));
        
        let dropIndex = columnTasks.length;
        
        // Only calculate position if there are existing tasks
        if (columnTasks.length > 0) {
            for (let i = 0; i < columnTasks.length; i++) {
                const taskRect = columnTasks[i].getBoundingClientRect();
                const middle = taskRect.top + taskRect.height / 2;
                
                if (e.clientY <= middle) {
                    dropIndex = i;
                    break;
                }
            }
        }
        
        // Update data structure
        const sourceColumnTasks = tasks[draggedTaskData.column];
        const targetColumnTasks = tasks[targetColumn.id];
        
        // Remove from source
        const taskIndex = sourceColumnTasks.findIndex(t => t.id === draggedTaskData.task.id);
        if (taskIndex !== -1) {
            sourceColumnTasks.splice(taskIndex, 1);
        }
        
        // Add to target
        const updatedTask = { ...draggedTaskData.task, column: targetColumn.id };
        targetColumnTasks.splice(dropIndex, 0, updatedTask);
        
        saveTasks();
        renderTasks();
    }
    
    // Clean up
    document.querySelectorAll('.column, .tasks').forEach(el => {
        el.classList.remove('drag-over');
    });
    
    document.querySelectorAll('.task').forEach(task => {
        task.classList.remove('shift-up', 'shift-down');
    });
    
    draggedTask = null;
    draggedTaskData = null;
});

function deleteTask(taskId, column) {
    tasks[column] = tasks[column].filter(task => task.id !== taskId);
    saveTasks();
    renderTasks();
}

function createTaskElement(taskText) {
    const template = document.getElementById('task-template');
    const taskElement = template.content.cloneNode(true);
    const task = taskElement.querySelector('.task');
    const taskContent = taskElement.querySelector('.task-content');
    const deleteButton = taskElement.querySelector('.delete-task');
    
    taskContent.textContent = taskText;
    deleteButton.addEventListener('click', deleteTask);
    
    return task;
}
