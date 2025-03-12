document.addEventListener('DOMContentLoaded', () => {
    // Delete task functionality
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('task-delete')) {
            const task = e.target.closest('.task');
            if (task) {
                task.remove();
            }
        }
    });
});
